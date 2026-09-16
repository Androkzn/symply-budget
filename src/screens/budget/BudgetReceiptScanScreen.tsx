import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { budgetApi, type BudgetCategory, type GroceryReceiptScanResult } from '@api/budget';
import { AIAccessGate } from '@components/ai/AIAccessGate';
import { CloudFilePicker } from '@components/cloud-storage';
import { AppBackground, OverlaySheetHeader, ProcessingOverlay, SafeAreaView, ScanImportSources, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Chip, GradientButton, TextInput, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { resolveCurrency, SUPPORTED_CURRENCIES, type CurrencyCode } from '@config/currencies';
import { formatRegionLabel } from '@config/regions';
import { useTheme } from '@contexts/ThemeContext';
import { budgetLocalUnsupportedCopyFromError } from '@features/budget/local/ai/localAiUnsupported';
import { aliasKeyForItem, listAliasHints, upsertAliases } from '@features/budget/local/receiptAliases';
import { takePendingReceiptDraft } from '@features/chat/receiptDraftStore';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import { useIsScrollableFormSheet } from '@navigation/presentation';
import type { BudgetStackParamList } from '@navigation/types';
import { getExchangeRate } from '@services/exchangeRates';
import ImageCropPicker from '@services/image-picker-compat';
import { showToast } from '@services/toastManager';
import { useAppStore } from '@stores/appStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { IconSize, useAppColors } from '@theme';
import { resolveCategoryIcon } from '@utils/budgetCategoryIcon';
import {
  convertCents,
  formatRate,
  isUsableRate,
  needsConversion,
  parseRate,
} from '@utils/currencyConversion';
import {
  formatLitres,
  formatPerLitre,
  normalizeVolumeUnit,
  pricePerLitre,
  toLitres,
} from '@utils/fuelUnits';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { formatMoney as formatAmount, useDisplayCurrency } from '@utils/money';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { BudgetCategoryCreateRow, useBudgetCategoryQuickCreate } from './budgetCategoryQuickCreate';
import { MONTH_ABBR } from './BudgetMonthHeader';
import { resolveReceiptExpenseDate } from './budgetQuickAddHelpers';
import { resolveScanCurrency } from './receiptCurrencyChoice';
import { IDLE_STAGE, scanOverlayCopy, type ScanStage } from './receiptScanProgress';


type Nav = NativeStackNavigationProp<BudgetStackParamList, 'BudgetReceiptScan'>;

const RECEIPT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

/** Max receipt sections per scan (a long receipt shot in parts). Matches the API cap. */
const MAX_RECEIPT_SEGMENTS = 12;

/**
 * The cloud picker hands back a file name but no mime type, so derive one from
 * the extension. Receipts can be a PDF or an image — fall back to JPEG.
 */
function inferReceiptMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

interface Attachment {
  uri: string;
  name: string;
  type: string;
}

interface DraftFee {
  kind: string;
  label: string;
  amount: number;
}

interface DraftItem {
  key: string;
  name: string;
  /**
   * Dollars string, TAX-INCLUSIVE, in the MEMBER'S currency — the one set in
   * Settings, not the one printed on the receipt.
   *
   * This is the number that will land in their budget, so it is the number the
   * field shows and the number they edit. Showing the printed foreign amount
   * here instead put the member in the position of reading "6.01" on a screen
   * whose every other total was in dollars of a different size, and left the
   * conversion as something they had to trust rather than see. The printed
   * amount is kept below in `sourceAmountCents` and rendered as the working —
   * visible, checkable against the paper, and not the thing being saved.
   */
  amount: string;
  /** Dollars string of savings, in the member's currency. */
  saved: string;
  /** Dollars string of sales tax already inside `amount`, member's currency. */
  tax: string;
  /**
   * The amounts as PRINTED, in the receipt's currency and in cents.
   *
   * Kept so the conversion can be shown as an arithmetic the member can follow,
   * and so a change of rate can re-derive the fields above from the original
   * figures rather than compounding a conversion on a converted number.
   */
  sourceAmountCents: number;
  sourceSavedCents: number;
  sourceTaxCents: number;
  /**
   * True once the member has typed into the money fields.
   *
   * A hand-entered amount is a decision, and a later rate change must not
   * silently overwrite it — that would take a correction away from the person
   * who made it, which is the same failure as converting behind their back.
   */
  amountEdited: boolean;
  depositCents: number;
  /** Measured amount the line stated (fuel volume, weight), or null. */
  quantity: number | null;
  /** Unit for `quantity`, exactly as the receipt printed it. */
  unit: string | null;
  /** Category for this line, or undefined for no category. */
  categoryId?: string;
  include: boolean;
  rawName?: string;
  rawCode?: string | null;
  nameSuggestions: string[];
  categorySuggestions: Array<{ id: string; name: string }>;
  fees: DraftFee[];
  showAllNames: boolean;
}

function centsToDollars(cents: number): string {
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number | null {
  const n = parseFloat(value);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Every amount on this screen is in the RECEIPT's currency until the moment it
 * is saved, so the code is a required argument rather than the member's
 * preference. Defaulting it was the bug this parameter exists to prevent: a
 * US receipt rendered "CA$45.20" while the paper in the member's hand said
 * "$45.20 USD", and nothing on screen disagreed with it.
 */
function formatMoney(cents: number, code: CurrencyCode): string {
  return formatAmount(cents, { decimals: 2, code });
}

function draftFromScanItem(
  item: GroceryReceiptScanResult['items'][number],
  fallbackCategoryId?: string | null,
): DraftItem {
  return {
    key: nextKey(),
    name: item.name,
    // Seeded from the PRINTED figures. The rate is fetched after the scan
    // returns, so there is nothing to convert with yet; the effect that owns
    // conversion re-derives these the moment a rate exists, and again whenever
    // it changes.
    amount: centsToDollars(item.amount),
    saved: centsToDollars(item.saved_amount),
    tax: centsToDollars(item.tax_amount ?? 0),
    sourceAmountCents: item.amount,
    sourceSavedCents: item.saved_amount,
    sourceTaxCents: item.tax_amount ?? 0,
    amountEdited: false,
    depositCents: item.deposit_amount ?? 0,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    categoryId: item.category_id ?? fallbackCategoryId ?? undefined,
    include: true,
    rawName: item.raw_name,
    rawCode: item.raw_code,
    nameSuggestions: item.name_suggestions ?? [],
    categorySuggestions: item.category_suggestions ?? [],
    fees: item.fees ?? [],
    showAllNames: false,
  };
}

let draftCounter = 0;
function nextKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

/** Longest failure reason worth putting in an alert — enough to identify it, short enough to read. */
const MAX_FAILURE_REASON_CHARS = 160;

/**
 * The generic "please try again" alone is a dead end: a retired model id, a
 * rejected key, and an oversized photo all look identical to the member and to
 * whoever reads the bug report. Append whatever the failure actually said —
 * provider errors are scrubbed of anything key-shaped before they get here.
 */
function scanFailureMessage(error: unknown): string {
  const base = 'Could not read that receipt. Please try again.';
  const reason = error instanceof Error ? error.message.trim() : '';
  if (!reason) return base;
  const trimmed =
    reason.length > MAX_FAILURE_REASON_CHARS
      ? `${reason.slice(0, MAX_FAILURE_REASON_CHARS)}…`
      : reason;
  return `${base}\n\n${trimmed}`;
}

export function BudgetReceiptScanScreen() {
  // Re-render amounts when Settings → Currency changes. The code itself is used
  // here, not just subscribed to: it is the currency the receipt converts INTO.
  const displayCurrency = useDisplayCurrency();
  const { theme } = useTheme();
  const colors = useAppColors();
  // Registered with `useScrollableFormPresentation`, so on iPhone this screen is
  // a page sheet whose card already starts below the status bar — see the hook.
  const insideSheet = useIsScrollableFormSheet();
  // How much of the screen the keypad is covering — used to lift the category
  // picker sheet, which is a Modal and so cannot rely on a KeyboardAvoidingView.
  const keyboardInset = useKeyboardInset();
  const navigation = useNavigation<Nav>();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, markInsightsDirty } = useBudgetStore();
  const taxCountry = useAppStore((s) => s.taxCountry);
  const taxRegion = useAppStore((s) => s.taxRegion);

  // A long receipt can be photographed in several parts — all are scanned as ONE.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [scan, setScan] = useState<GroceryReceiptScanResult | null>(null);
  const [storeName, setStoreName] = useState('');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  /**
   * Whether the category fetch has SETTLED — not whether it found anything.
   *
   * Without this the picker read "Loading categories…" forever whenever the
   * list came back empty, because the copy was chosen on `length === 0` alone.
   * Empty is a real, stable state here: a device that has adopted a household
   * but is still awaiting enrolment holds no key, so the engine can read
   * nothing and returns zero categories indefinitely (observed 2026-09-07 —
   * "still waiting for the household key — nothing can be read or written
   * yet"). Telling that member "Loading…" describes a fetch that finished
   * long ago and invites them to wait for something that will never arrive.
   */
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  // What the scan is doing right now, so the blocking overlay can say something
  // true instead of an unchanging spinner. `preparing`/`uploading` know their
  // end (files, bytes); `reading` does not — it reports items read so far.
  const [scanStage, setScanStage] = useState<ScanStage>(IDLE_STAGE);
  const [isSaving, setIsSaving] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  // ── Foreign receipts ──────────────────────────────────────────────────────
  // A receipt bought abroad prints its own currency. Its amounts stay in that
  // currency for the whole review — the member is checking them against the
  // paper — and are converted exactly once, on save. Defaults to the member's
  // own currency, which makes every domestic scan a no-op.
  const [receiptCurrency, setReceiptCurrency] = useState<CurrencyCode>(displayCurrency);
  /**
   * A currency the MEMBER named, as opposed to one the scan inferred.
   *
   * Detection is deliberately cautious — a receipt printing only "$" against an
   * unknown home region is read as the member's own currency, because guessing
   * would convert a domestic shop at a rate nobody asked for. That caution has
   * a cost: the member who KNOWS this receipt is American had no way to say so
   * before scanning, and could only correct it afterwards, once every amount on
   * screen had already been read as theirs.
   *
   * Set before a scan, it pre-empts detection entirely; set after, it overrules
   * it. Null means "no opinion — let the receipt and my region decide".
   */
  const [currencyOverride, setCurrencyOverride] = useState<CurrencyCode | null>(null);
  const [rateText, setRateText] = useState('');
  /**
   * What the card was actually charged, in the member's own currency.
   *
   * The rate is the derived quantity, not the known one. Nobody remembers the
   * rate their bank used — they have a statement line saying CA$228.86, which
   * already includes whatever spread and foreign-transaction fee was applied.
   * Entering that gives a figure that reconciles with the statement exactly,
   * where a reference rate only ever gets close.
   */
  const [chargedText, setChargedText] = useState('');
  /**
   * The charged total the member has COMMITTED, in cents — null until they
   * press Apply.
   *
   * Deliberately separate from the text they are typing. Deriving the rate
   * straight from the field recalculated the whole receipt on every keystroke,
   * so typing "228.86" walked every line and total through the rates implied by
   * 2, 22, 228 and 228.8 — a screen of numbers churning under the member while
   * they were still entering the figure. Apply makes the recalculation one
   * deliberate event they can see the result of.
   */
  const [appliedChargedCents, setAppliedChargedCents] = useState<number | null>(null);
  /** Provenance of the rate in the box, for the caption under it. */
  const [rateAsOf, setRateAsOf] = useState<string | null>(null);
  const [isRateLoading, setIsRateLoading] = useState(false);
  const [rateLookupFailed, setRateLookupFailed] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  // Key of the draft whose category picker is open, or null when closed.
  const [categoryPickerKey, setCategoryPickerKey] = useState<string | null>(null);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  // The picker's search box doubles as the name field for an inline category,
  // so "Create a new category" with nothing typed just focuses it.
  const categorySearchInputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    if (!currentHousehold?.id) return;
    budgetApi
      .getCategories(currentHousehold.id)
      .then((res) => setCategories(res.categories))
      .catch(() => {})
      // Settled either way: a failed fetch is not a pending one, and the row
      // must stop claiming to be busy.
      .finally(() => setCategoriesLoaded(true));
  }, [currentHousehold?.id]);

  // Prefill from Budget chat: AI scanned a receipt but nothing is saved until
  // the member edits + confirms each line here (same UX as a local scan).
  useEffect(() => {
    const pending = takePendingReceiptDraft();
    if (!pending || pending.items.length === 0) return;
    setScan(pending);
    setStoreName(pending.vendor?.trim() || 'Other');
    setDrafts(pending.items.map((item) => draftFromScanItem(item, pending.category_id)));
    setReceiptCurrency(
      resolveScanCurrency({
        printed: pending.receipt_currency,
        receiptCountry: pending.receipt_country,
        memberCountry: taxCountry,
        memberCurrency: displayCurrency,
      }),
    );
    // Mount-only: this consumes a one-shot handoff from Budget chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    let spent = 0;
    let saved = 0;
    let tax = 0;
    let deposits = 0;
    let count = 0;
    for (const d of drafts) {
      if (!d.include) continue;
      const amount = dollarsToCents(d.amount);
      if (amount === null || amount <= 0) continue;
      spent += amount; // tax-inclusive
      saved += dollarsToCents(d.saved) ?? 0;
      tax += Math.min(dollarsToCents(d.tax) ?? 0, amount);
      deposits += d.depositCents;
      count += 1;
    }
    // Subtotal is the pre-tax portion of what will be spent.
    return { spent, saved, tax, deposits, subtotal: spent - tax, count };
  }, [drafts]);

  const isForeign = needsConversion(receiptCurrency, displayCurrency);
  const typedRate = parseRate(rateText);

  /**
   * Look the rate up whenever the pair changes.
   *
   * Only ever PRE-FILLS the box: if the member has already typed a rate for
   * this pair we leave it alone, because a lookup landing a second later and
   * overwriting what they typed is the kind of thing that gets noticed only
   * after the import is saved. `cancelled` covers the same race across a fast
   * currency switch — the first pair's answer must not fill in the second's.
   */
  useEffect(() => {
    if (!isForeign) {
      setRateText('');
      setChargedText('');
      setAppliedChargedCents(null);
      setRateAsOf(null);
      setRateLookupFailed(false);
      return;
    }
    let cancelled = false;
    setIsRateLoading(true);
    setRateLookupFailed(false);
    getExchangeRate(receiptCurrency, displayCurrency)
      .then((found) => {
        if (cancelled) return;
        if (found) {
          setRateText(formatRate(found.rate));
          setRateAsOf(found.asOf);
        } else {
          setRateLookupFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Deliberately NOT keyed on `rateText`: this effect fills the box, it does
    // not react to it. Adding it would re-run the lookup on every keystroke and
    // overwrite the member mid-type.
  }, [receiptCurrency, displayCurrency, isForeign]);

  /**
   * The charged total wins when it is filled in, because it is the more
   * authoritative fact: a statement figure beats a reference rate, spread and
   * fees included. Dividing it by the receipt total is the rate the member
   * actually paid, and every downstream calculation — per line, totals, save —
   * then flows from it unchanged.
   */
  /**
   * What the receipt itself says, for the rows being imported — summed from the
   * PRINTED figures rather than from the displayed ones.
   *
   * This has to be the printed side, and not only for tidiness: the displayed
   * amounts are a FUNCTION of the rate, so dividing the charged total by them
   * makes the rate depend on itself. Applying a charged total then moved the
   * amounts, which moved the total, which moved the rate — a loop that renders
   * until the heap is gone (measured 2026-09-09: V8 OOM on the derived-rate
   * test). The printed total is fixed by the paper and cannot participate.
   */
  const receiptTotalSource = useMemo(
    () =>
      drafts.reduce(
        (sum, d) => (d.include && !d.amountEdited ? sum + d.sourceAmountCents : sum),
        0,
      ),
    [drafts],
  );

  const derivedRate =
    appliedChargedCents !== null && appliedChargedCents > 0 && receiptTotalSource > 0
      ? appliedChargedCents / receiptTotalSource
      : null;
  /** What Apply would commit right now, or null when the field is unusable. */
  const pendingChargedCents = dollarsToCents(chargedText);
  const canApplyCharged =
    pendingChargedCents !== null &&
    pendingChargedCents > 0 &&
    receiptTotalSource > 0 &&
    pendingChargedCents !== appliedChargedCents;
  const rate = derivedRate !== null && isUsableRate(derivedRate) ? derivedRate : typedRate;

  /** A foreign receipt cannot be saved until there is a rate to save it at. */
  const missingRate = isForeign && rate === null;

  /**
   * Re-derive the money fields from the PRINTED figures whenever the rate moves.
   *
   * The fields hold the member's own currency, so they are a function of the
   * receipt's amounts and the rate — not a store of their own. Deriving them
   * from `sourceAmountCents` each time, rather than converting whatever is
   * currently displayed, is what stops a second rate change from converting an
   * already-converted number: applying 1.38 to a figure that is already CAD
   * would look plausible and be wrong by the whole rate.
   *
   * Rows the member has typed into are left alone — see `amountEdited`.
   */
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = prev.map((d) => {
        if (d.amountEdited) return d;
        const convert = (cents: number) =>
          isForeign && rate !== null ? convertCents(cents, rate, displayCurrency) : cents;
        const amount = centsToDollars(convert(d.sourceAmountCents));
        const saved = centsToDollars(convert(d.sourceSavedCents));
        const tax = centsToDollars(convert(d.sourceTaxCents));
        if (amount === d.amount && saved === d.saved && tax === d.tax) return d;
        changed = true;
        return { ...d, amount, saved, tax };
      });
      return changed ? next : prev;
    });
    // `drafts` is a dependency, not just an input.
    //
    // Without it the effect only fires when the RATE moves, so a scan that
    // lands after the rate was already fetched — which is exactly what happens
    // when the member declares the currency BEFORE scanning — produced rows
    // that were never converted, and the receipt imported at par. The bug is
    // silent: the amounts look like the ones on the paper, because they are.
    //
    // Re-entering is safe: the map returns the SAME array reference when
    // nothing needs changing, so React bails out of the re-render rather than
    // looping.
  }, [rate, isForeign, displayCurrency, drafts]);



  const addAttachments = (next: Attachment[]) =>
    setAttachments((prev) => [...prev, ...next].slice(0, MAX_RECEIPT_SEGMENTS));

  const removeAttachment = (uri: string) =>
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));

  const handlePickFromCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      addAttachments([
        {
          uri: image.path,
          name: image.filename || 'receipt.jpg',
          type: image.mime || 'image/jpeg',
        },
      ]);
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error opening camera:', error);
        Alert.alert('Error', 'Could not open the camera.');
      }
    }
  };

  const handlePickFromGallery = async () => {
    try {
      // Multi-select so all sections of a long receipt can be added at once.
      const picked = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
        multiple: true,
      });
      const images = Array.isArray(picked) ? picked : [picked];
      addAttachments(
        images.map((image) => ({
          uri: image.path,
          name: image.filename || 'receipt.jpg',
          type: image.mime || 'image/jpeg',
        }))
      );
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        console.error('Error picking image:', error);
        Alert.alert('Error', 'Could not open the photo library.');
      }
    }
  };

  const handleUploadFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...RECEIPT_MIMES],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!result.canceled && result.assets.length > 0) {
        addAttachments(
          result.assets.map((asset) => ({
            uri: asset.uri,
            name: asset.name || 'receipt',
            type: asset.mimeType || 'image/jpeg',
          }))
        );
      }
    } catch (error) {
      console.error('Error picking file:', error);
      Alert.alert('Error', 'Could not open the file picker.');
    }
  };

  const handleDriveFileSelected = (file: { uri: string; name: string; size: number }) => {
    setShowDrivePicker(false);
    const name = file.name || 'receipt';
    addAttachments([{ uri: file.uri, name, type: inferReceiptMime(name) }]);
  };

  const handleScan = async () => {
    if (!currentHousehold?.id || attachments.length === 0) return;
    setIsScanning(true);
    setScanStage({ kind: 'preparing', done: 0, total: attachments.length });
    setScan(null);
    setDrafts([]);
    try {
      // Sequential rather than Promise.all: each shrink is CPU-bound anyway, and
      // one-at-a-time is what lets the overlay name the photo being prepared.
      const prepared: Attachment[] = [];
      for (const attachment of attachments) {
        prepared.push(await toVisionSafeAttachment(attachment));
        setScanStage({ kind: 'preparing', done: prepared.length, total: attachments.length });
      }
      const aliases = await listAliasHints();
      // Open on `reading` — that is the truthful default for a path that never
      // uploads (local-first sends the images straight to the member's own
      // provider) and it degrades to today's plain spinner when nothing reports.
      setScanStage({ kind: 'reading', items: 0 });
      const result = await budgetApi.scanReceipt(
        currentHousehold.id,
        prepared,
        {
          country: taxCountry,
          stateProvince: taxRegion,
        },
        aliases,
        (progress) =>
          setScanStage(
            progress.stage === 'reading'
              ? { kind: 'reading', items: progress.items }
              : // The last byte of the upload is the first moment of the read;
                // a bar frozen at 100% for 20s is the stall we set out to remove.
                progress.fraction >= 1
                ? { kind: 'reading', items: 0 }
                : { kind: 'uploading', fraction: progress.fraction }
          )
      );
      setScan(result);
      setStoreName(result.vendor?.trim() || 'Other');
      setDrafts(result.items.map((item) => draftFromScanItem(item, result.category_id)));
      // No decisive currency on the receipt means the member's own — never a
      // guess. Guessing here would convert a domestic receipt at a rate nobody
      // asked for, which is strictly worse than not converting at all.
      // A currency the member named before scanning wins: they have the paper
      // in front of them, and detection is only ever an inference about it.
      setReceiptCurrency(
        currencyOverride ??
          resolveScanCurrency({
            printed: result.receipt_currency,
            receiptCountry: result.receipt_country,
            memberCountry: taxCountry,
            memberCurrency: displayCurrency,
          }),
      );
      if (__DEV__) {
        console.log('[BUDGET-E2E][scan.review]', {
          vendor: result.vendor,
          itemCount: result.items.length,
          aliasCount: aliases.length,
          suggestionCounts: result.items.map((item) => item.name_suggestions?.length ?? 0),
        });
      }
      if (result.items.length === 0) {
        Alert.alert(
          'Nothing found',
          'Could not read any items from that receipt. Try a clearer, well-lit photo of the whole receipt.'
        );
      }
    } catch (error) {
      console.error('Error scanning receipt:', error);
      const offlineCopy = budgetLocalUnsupportedCopyFromError(error, 'receipt');
      Alert.alert(
        offlineCopy?.title ?? 'Error',
        offlineCopy?.message ?? scanFailureMessage(error),
      );
    } finally {
      setIsScanning(false);
      setScanStage(IDLE_STAGE);
    }
  };

  const updateDraft = (key: string, patch: Partial<DraftItem>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const toggleDraft = (key: string) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, include: !d.include } : d)));

  const removeDraft = (key: string) => setDrafts((prev) => prev.filter((d) => d.key !== key));

  const addBlankDraft = () =>
    setDrafts((prev) => [
      ...prev,
      {
        key: nextKey(),
        name: '',
        amount: '',
        saved: '',
        tax: '',
        // A hand-added row is authored in the member's own currency, so it has
        // no printed original and must never be re-derived by the rate effect.
        sourceAmountCents: 0,
        sourceSavedCents: 0,
        sourceTaxCents: 0,
        amountEdited: true,
        depositCents: 0,
        quantity: null,
        unit: null,
        categoryId: scan?.category_id ?? undefined,
        include: true,
        nameSuggestions: [],
        categorySuggestions: [],
        fees: [],
        showAllNames: false,
      },
    ]);

  const closeCategoryPicker = () => {
    setCategoryPickerKey(null);
    setCategorySearchQuery('');
  };

  // Receipts are exactly where a missing category bites: the line is already
  // extracted and nothing fits. Create it here, assign it to that line, done.
  const { isCreatingCategory, createCategory } = useBudgetCategoryQuickCreate({
    householdId: currentHousehold?.id,
    categories,
    onCreated: (category) => {
      setCategories((prev) =>
        prev.some((cat) => cat.id === category.id) ? prev : [...prev, category]
      );
      if (categoryPickerKey) updateDraft(categoryPickerKey, { categoryId: category.id });
      closeCategoryPicker();
    },
  });

  const filteredCategories = useMemo(() => {
    const q = categorySearchQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((cat) => cat.name.toLowerCase().includes(q));
  }, [categories, categorySearchQuery]);

  const expenseDate = useMemo(
    () => resolveReceiptExpenseDate(scan?.purchase_date, selectedYear, selectedMonth),
    [scan?.purchase_date, selectedYear, selectedMonth]
  );

  const persist = async (
    householdId: string,
    toSave: Array<{
      name: string;
      amount: number;
      saved: number;
      tax: number;
      deposit: number;
      categoryId?: string;
      rawCode?: string | null;
      rawName?: string;
    }>
  ) => {
    setIsSaving(true);
    // NO CONVERSION HERE, deliberately.
    //
    // Conversion happens once, upstream, in the effect that derives the money
    // fields from the printed figures — so by the time a row reaches this
    // function it is already in the member's own currency, which is also the
    // number they saw and could edit. Converting again here would double-apply
    // the rate, and the result would look entirely plausible.
    try {
      await budgetApi.addExpensesBulk(
        householdId,
        toSave.map((item) => ({
          title: item.name,
          amount: item.amount, // tax-inclusive, already in the member's currency
          saved_amount: item.saved,
          tax_amount: item.tax, // portion of amount that is sales tax
          deposit_amount: item.deposit,
          expense_date: expenseDate,
          // Each draft is already defaulted to its category at creation, so an
          // undefined id here means the user deliberately chose "No category".
          category_id: item.categoryId ?? undefined,
          vendor: storeName.trim() || 'Other',
        }))
      );
      await upsertAliases(
        toSave.map((item) => ({
          key: aliasKeyForItem(item.rawCode, item.rawName || item.name),
          name: item.name,
          categoryId: item.categoryId ?? null,
        })),
      );
      markInsightsDirty(householdId);
      // A receipt keeps its OWN printed date when that date is recent
      // (resolveReceiptExpenseDate trusts up to 13 months back), so scanning a
      // July receipt while viewing August files the expenses under July —
      // correctly, but into a month the member is not looking at. The Spent
      // list is filtered by the selected month, so the screen they land back on
      // is unchanged and the import reads as "Save did nothing".
      //
      // Follow the money: say which month it went to, and take them there.
      const [savedYear, savedMonth] = [
        Number(expenseDate.slice(0, 4)),
        Number(expenseDate.slice(5, 7)),
      ];
      const landedElsewhere = savedYear !== selectedYear || savedMonth !== selectedMonth;
      const countLabel = `${toSave.length} item${toSave.length > 1 ? 's' : ''}`;
      // NAME the month, do not navigate to it. Moving `selectedMonth` here was
      // tried and reverted: it is shared by Home, Planning, Spending and
      // Savings AND persisted, so scanning a July receipt in August left the
      // whole app parked in July long after the import — including across app
      // launches. Relocating the member's month context without asking is a
      // bigger change than the bug warranted; the toast tells them where the
      // money went and leaves them where they were.
      showToast(
        'success',
        landedElsewhere
          ? `Added ${countLabel} to ${MONTH_ABBR[savedMonth - 1]} ${savedYear}`
          : `Added ${countLabel}`
      );
      navigation.goBack();
    } catch (error) {
      console.error('Error saving receipt items:', error);
      showToast('error', 'Could not save these items. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!currentHousehold?.id) return;
    const householdId = currentHousehold.id;

    // The Save button is already disabled without a rate; this is the second
    // lock on the same door, because saving a foreign receipt at par corrupts
    // the budget silently and is not something a member could spot afterwards.
    if (missingRate) {
      Alert.alert(
        'Exchange rate needed',
        `This receipt is in ${receiptCurrency} but your budget is in ${displayCurrency}. Enter the rate to convert it.`,
      );
      return;
    }

    const included = drafts.filter((d) => d.include);
    const toSave = included
      .map((d) => {
        const amount = dollarsToCents(d.amount);
        return {
          name: d.name.trim(),
          amount,
          saved: dollarsToCents(d.saved) ?? 0,
          // Never let tax exceed the (inclusive) amount.
          tax: Math.min(dollarsToCents(d.tax) ?? 0, amount ?? 0),
          deposit: d.depositCents,
          categoryId: d.categoryId,
          rawCode: d.rawCode,
          rawName: d.rawName,
        };
      })
      .filter((d) => d.name.length > 0 && d.amount !== null && d.amount > 0) as Array<{
      name: string;
      amount: number;
      saved: number;
      tax: number;
      deposit: number;
      categoryId?: string;
      rawCode?: string | null;
      rawName?: string;
    }>;

    if (toSave.length === 0) {
      Alert.alert('Nothing to add', 'Select at least one item with a name and price.');
      return;
    }

    // Some selected rows are missing a name or a valid price and would be
    // silently dropped — surface that so the user can fix them first.
    //
    // A row that is ENTIRELY blank does not count. "Add item" creates one
    // pre-checked and empty, so a member who taps it and changes their mind
    // was being told "1 selected item is missing a name or price and won't be
    // added" about a row they never filled in — a warning about nothing, on the
    // way out of the screen. Untouched blanks are just dropped; a row with a
    // name but no price, or a price but no name, is still worth warning about
    // because that one holds real intent.
    const isUntouched = (d: DraftItem) => !d.name.trim() && !d.amount.trim() && !d.saved.trim();
    const skipped = included.filter((d) => !isUntouched(d)).length - toSave.length;
    if (skipped > 0) {
      Alert.alert(
        'Some items will be skipped',
        `${skipped} selected ${
          skipped === 1 ? 'item is' : 'items are'
        } missing a name or price and won't be added. Add the other ${toSave.length}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add anyway', onPress: () => persist(householdId, toSave) },
        ]
      );
      return;
    }

    await persist(householdId, toSave);
  };

  return (
    <AIAccessGate title="Unlock AI for receipts">
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-receipt-scan">
      <ScreenHeader
        title="Scan receipt"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
        insideSheet={insideSheet}
      />
      {/* No KeyboardAvoidingView: it only SHRINKS the viewport, it never
          scrolls the focused field back into view, and stacked on
          `automaticallyAdjustKeyboardInsets` it double-counts the keyboard.
          `keyboardDismissScrollProps` is the half that reveals the field —
          see `@utils/keyboard`. */}
      <ScrollView
        {...keyboardDismissScrollProps}
        style={[screenScrollViewStyle.scroll, styles.flex]}
        contentContainerStyle={styles.content}
      >
        <Typography variant="footnote" weight="medium" color={colors.textSecondary}>
          Snap any receipt — each item is added as an expense and discounts are tracked as savings.
        </Typography>

        <ScanImportSources
          testIDPrefix="budget-receipt"
          disabled={isScanning}
          onCamera={handlePickFromCamera}
          onGallery={handlePickFromGallery}
          onFile={handleUploadFile}
          onDrive={() => setShowDrivePicker(true)}
        />

        {attachments.length > 0 && (
          <View style={styles.attachmentList}>
            {attachments.length > 1 && (
              <Typography variant="caption2" color={colors.textSecondary}>
                {attachments.length} sections — scanned together as one receipt
              </Typography>
            )}
            {attachments.map((att, index) => (
              <View
                key={att.uri}
                style={[
                  styles.attachmentChip,
                  { backgroundColor: colors.backgroundSecondary, borderColor: theme.pastel.teal },
                ]}
              >
                <Icon name="receipt-outline" size={18} color={theme.pastel.teal} />
                <Typography
                  variant="caption1"
                  weight="medium"
                  style={styles.attachmentName}
                  numberOfLines={1}
                >
                  {attachments.length > 1 ? `${index + 1}. ${att.name}` : att.name}
                </Typography>
                <TouchableOpacity
                  onPress={() => removeAttachment(att.uri)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID="budget-receipt-remove"
                >
                  <Icon name="close-circle" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <GradientButton
          title={attachments.length > 1 ? `Scan ${attachments.length} sections` : 'Scan receipt'}
          variant="blue"
          onPress={handleScan}
          disabled={isScanning || attachments.length === 0}
          loading={isScanning}
          fullWidth
          testID="budget-receipt-scan-button"
        />

        {/*
          OPTIONAL, AND BEFORE THE SCAN — "this one is in another currency".

          Detection runs on what the receipt prints and where the member says
          they are, and is deliberately unwilling to guess: a bare "$" with no
          known home region reads as the member's own currency, because
          converting a domestic shop at an unasked-for rate is the worse
          error. The member holding the paper often knows better, and until
          now had no way to say so until after the scan — by which point every
          amount on screen had already been read as theirs.

          Stated as a question rather than a toggle: it is not a setting, it
          is a fact about the receipt in their hand. It stays visible after a
          scan too, so "the scan got this wrong" and "I knew in advance" are
          the same one control rather than two.
        */}
        <TouchableOpacity
          style={[
            styles.foreignPrompt,
            {
              backgroundColor: colors.backgroundSecondary,
              borderColor: currencyOverride ? theme.pastel.teal : colors.borderColor,
            },
          ]}
          onPress={() => setShowCurrencyPicker(true)}
          disabled={isScanning}
          testID="budget-receipt-currency-hint"
        >
          <Icon
            name="globe-outline"
            size={18}
            color={currencyOverride ? theme.pastel.teal : colors.textSecondary}
          />
          <Typography variant="caption1" color={colors.textSecondary} style={styles.noticeText}>
            {currencyOverride
              ? `${resolveCurrency(currencyOverride).flag}  Bought in ${resolveCurrency(currencyOverride).label} (${currencyOverride}) — converts to ${displayCurrency}`
              : `Bought in another currency? Tap if this receipt is not in ${displayCurrency}.`}
          </Typography>
          {currencyOverride ? (
            <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
              {currencyOverride}
            </Typography>
          ) : (
            <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
          )}
        </TouchableOpacity>

        {scan && (
          <>
            <TextInput
              label="Store"
              value={storeName}
              onChangeText={setStoreName}
              placeholder="Other"
              testID="budget-receipt-store"
            />
            {!!scan.purchase_date && (
              <Typography variant="caption1" color={colors.textSecondary} style={styles.reviewLabel}>
                {scan.purchase_date}
              </Typography>
            )}

            {/* Currency card. Always present once there is a scan, even for a
                domestic receipt: it is the only place that says what currency
                the prices below are being read as, and a member who scanned a
                US receipt that printed a bare "$" needs to be able to correct
                the assumption rather than discover it in their totals. */}
            <View
              style={[
                styles.currencyCard,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
              ]}
              testID="budget-receipt-currency-card"
            >
              {/*
                WHAT THE SCAN READ OFF THE PRINTED ADDRESS.

                A receipt almost always carries the store's address, and the
                scan already extracts it — it is what picks the sales-tax
                profile, so a Washington receipt is taxed at Washington's
                rates rather than the member's own. That work was invisible:
                the tax simply appeared and the member had no way to see which
                jurisdiction produced it, or to notice when the address had
                been misread. Showing it makes the inference checkable, and
                explains why a receipt from elsewhere is being treated as
                foreign in the first place.
              */}
              {!!formatRegionLabel(scan.receipt_country, scan.receipt_region) && (
                <View style={styles.detectedRow} testID="budget-receipt-detected-region">
                  <Icon name="location-outline" size={16} color={colors.textSecondary} />
                  <Typography
                    variant="caption2"
                    color={colors.textSecondary}
                    style={styles.noticeText}
                  >
                    {`Receipt address: ${formatRegionLabel(
                      scan.receipt_country,
                      scan.receipt_region,
                    )} — used for its sales tax`}
                  </Typography>
                </View>
              )}

              <View style={styles.currencyRow}>
                <Typography variant="caption1" color={colors.textSecondary}>
                  Receipt is in
                </Typography>
                <TouchableOpacity
                  style={[
                    styles.currencyButton,
                    { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
                  ]}
                  onPress={() => setShowCurrencyPicker(true)}
                  testID="budget-receipt-currency"
                >
                  <Typography variant="body" weight="semibold">
                    {`${resolveCurrency(receiptCurrency).flag}  ${receiptCurrency}`}
                  </Typography>
                  <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>

              {isForeign && (
                <>
                  <View style={styles.rateRow}>
                    <Typography variant="body" color={colors.textSecondary}>
                      {`1 ${receiptCurrency} =`}
                    </Typography>
                    <View style={styles.rateField}>
                      <TextInput
                        value={derivedRate !== null ? formatRate(derivedRate) : rateText}
                        onChangeText={(t) => {
                          setRateText(t);
                          // Hand-typed from here on — the fetched date would
                          // otherwise keep vouching for a number the member
                          // has since overwritten.
                          setRateAsOf(null);
                        }}
                        // Read-only while a charged total is driving it: two
                        // editable fields that each recompute the other is how
                        // a member ends up unable to get either back.
                        editable={derivedRate === null}
                        keyboardType="decimal-pad"
                        placeholder={isRateLoading ? 'Looking up…' : '0.00'}
                        testID="budget-receipt-rate"
                      />
                    </View>
                    <Typography variant="body" weight="semibold">
                      {displayCurrency}
                    </Typography>
                  </View>
                  {/* THE SECOND WAY IN, and usually the better one: a member
                      knows what their card was charged, not what rate their
                      bank used. Entering the statement figure derives a rate
                      that already includes the spread and any foreign
                      transaction fee, so the import reconciles with the
                      statement exactly rather than approximately. Optional —
                      leaving it blank keeps the reference rate above. */}
                  <View style={styles.rateRow}>
                    <Typography variant="body" color={colors.textSecondary}>
                      {`Charged in ${displayCurrency}`}
                    </Typography>
                    <View style={styles.rateField}>
                      <TextInput
                        value={chargedText}
                        onChangeText={setChargedText}
                        keyboardType="decimal-pad"
                        placeholder="optional"
                        testID="budget-receipt-charged"
                      />
                    </View>
                    {/* Apply, not live: committing on a tap recalculates the
                        whole receipt ONCE, at a moment the member chose.
                        Doubles as Clear — emptying the field and applying
                        hands the reference rate back, so there is always a
                        way out of a figure they no longer want. */}
                    <TouchableOpacity
                      onPress={() => {
                        setAppliedChargedCents(pendingChargedCents);
                        if (pendingChargedCents === null) setChargedText('');
                      }}
                      disabled={!canApplyCharged && appliedChargedCents === null}
                      style={[
                        styles.applyButton,
                        {
                          borderColor:
                            canApplyCharged || appliedChargedCents !== null
                              ? theme.pastel.teal
                              : colors.borderColor,
                        },
                      ]}
                      testID="budget-receipt-charged-apply"
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={
                          canApplyCharged || appliedChargedCents !== null
                            ? theme.pastel.teal
                            : colors.textTertiary
                        }
                      >
                        {pendingChargedCents === null && appliedChargedCents !== null
                          ? 'Clear'
                          : 'Apply'}
                      </Typography>
                    </TouchableOpacity>
                  </View>
                  <Typography
                    variant="caption2"
                    color={missingRate ? colors.error : colors.textSecondary}
                    testID="budget-receipt-rate-caption"
                  >
                    {derivedRate !== null
                      ? `Rate from what you were charged — includes your bank's spread and fees.`
                      : missingRate
                        ? rateLookupFailed
                          ? 'Could not fetch a rate — enter one, or the total you were charged.'
                          : 'Enter the rate, or the total your card charged.'
                        : rateAsOf
                          ? `Reference rate for ${rateAsOf}. Or enter what your card charged.`
                          : `Your rate. Prices below are already in ${displayCurrency}.`}
                  </Typography>
                </>
              )}
            </View>

            {drafts.length > 0 &&
              totals.tax === 0 &&
              (scan.tax_source === 'none' || scan.tax_source === undefined) && (
                <View
                  style={[
                    styles.noticeBanner,
                    { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
                  ]}
                  testID="budget-receipt-tax-notice"
                >
                  <Icon name="information-circle-outline" size={18} color={theme.pastel.teal} />
                  <Typography variant="caption1" color={colors.textSecondary} style={styles.noticeText}>
                    {formatRegionLabel(taxCountry, taxRegion)
                      ? 'No sales tax was printed on this receipt, so none was added.'
                      : 'No tax detected. Set your region in Settings → Region so tax can be added automatically when a receipt doesn’t print it.'}
                  </Typography>
                </View>
              )}

            {drafts.length > 0 && (
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                style={styles.reviewLabel}
              >
                Review each item — price is tax-inclusive; edit name, price, savings, and category
              </Typography>
            )}

            {drafts.map((d) => (
              <View
                key={d.key}
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.backgroundSecondary,
                    borderColor: d.include ? theme.pastel.teal : colors.borderColor,
                  },
                ]}
              >
                <View style={styles.cardTop}>
                  <TouchableOpacity
                    onPress={() => toggleDraft(d.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[
                      styles.check,
                      {
                        borderColor: d.include ? theme.pastel.teal : colors.borderColor,
                        backgroundColor: d.include ? theme.pastel.teal : 'transparent',
                      },
                    ]}
                    testID="budget-receipt-toggle"
                  >
                    {d.include && <Icon name="checkmark" size={14} color={colors.white} />}
                  </TouchableOpacity>
                  <View style={styles.nameField}>
                    <TextInput
                      value={d.name}
                      onChangeText={(t) => updateDraft(d.key, { name: t })}
                      placeholder="Item name"
                      testID="budget-receipt-name"
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => removeDraft(d.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    testID="budget-receipt-remove-item"
                  >
                    <Icon name="trash-outline" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                {d.nameSuggestions.filter((s) => s.toLowerCase() !== d.name.toLowerCase()).length >
                  0 && (
                  <View style={styles.chipRow} testID="budget-receipt-name-chips">
                    {(d.showAllNames
                      ? d.nameSuggestions
                      : d.nameSuggestions.slice(0, 3)
                    )
                      .filter((s) => s.toLowerCase() !== d.name.toLowerCase())
                      .map((suggestion) => (
                        <Chip
                          key={suggestion}
                          label={suggestion}
                          size="sm"
                          outlined
                          testID="budget-receipt-name-chip"
                          onPress={() => updateDraft(d.key, { name: suggestion })}
                        />
                      ))}
                    {!d.showAllNames && d.nameSuggestions.length > 3 && (
                      <Chip
                        label="More"
                        size="sm"
                        variant="primary"
                        outlined
                        testID="budget-receipt-name-more"
                        onPress={() => updateDraft(d.key, { showAllNames: true })}
                      />
                    )}
                  </View>
                )}
                {/* Tax and fees are both FACTS about this line, so they share
                    one row of filled pills. They used to be two stacked rows
                    and the Tax pill sat alone, which is most of why the card
                    read as scattered. Wrappers keep their testIDs. */}
                <View style={styles.factRow}>
                  <View testID="budget-receipt-tax-pill">
                    <Chip
                      label={(dollarsToCents(d.tax) ?? 0) > 0 ? 'Tax' : 'No tax'}
                      size="sm"
                      variant={(dollarsToCents(d.tax) ?? 0) > 0 ? 'warning' : 'secondary'}
                      testID={(dollarsToCents(d.tax) ?? 0) > 0 ? 'budget-receipt-tax' : 'budget-receipt-no-tax'}
                    />
                  </View>
                  {d.fees.length > 0 && (
                    <View style={styles.factRowInner} testID="budget-receipt-fee-chips">
                      {d.fees.map((fee, idx) => (
                      <Chip
                        key={`${fee.kind}-${idx}`}
                        label={`${fee.label} ${formatMoney(fee.amount, receiptCurrency)}`}
                        size="sm"
                        variant="secondary"
                        testID="budget-receipt-fee-chip"
                        onRemove={() => {
                          // Take the fee off the PRINTED amount, not the
                          // displayed one. `fee.amount` came from the receipt
                          // and is in the receipt's currency, while the field
                          // now holds the member's — subtracting one from the
                          // other mixes two different-sized dollars, and the
                          // rate effect would overwrite the result anyway on
                          // its next pass. Changing the source lets the
                          // conversion re-derive the field, so the displayed
                          // figure stays a true conversion of a true total.
                          const nextFees = d.fees.filter((_, i) => i !== idx);
                          const nextSource = Math.max(0, d.sourceAmountCents - fee.amount);
                          const nextDeposit =
                            fee.kind === 'deposit' || fee.kind === 'crv'
                              ? Math.max(0, d.depositCents - fee.amount)
                              : d.depositCents;
                          updateDraft(d.key, {
                            fees: nextFees,
                            sourceAmountCents: nextSource,
                            depositCents: nextDeposit,
                          });
                        }}
                        />
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.priceRow}>
                  <View style={styles.priceField}>
                    <TextInput
                      label={isForeign ? `Price (${displayCurrency})` : 'Price'}
                      value={d.amount}
                      // `amountEdited` stops the rate effect from re-deriving
                      // this row: a typed figure is the member's decision and
                      // outranks the arithmetic.
                      onChangeText={(t) => updateDraft(d.key, { amount: t, amountEdited: true })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      testID="budget-receipt-amount"
                    />
                  </View>
                  <View style={styles.priceField}>
                    <TextInput
                      label="Saved"
                      value={d.saved}
                      // `amountEdited` stops the rate effect from re-deriving
                      // this row: a typed figure is the member's decision and
                      // outranks the arithmetic.
                      onChangeText={(t) => updateDraft(d.key, { saved: t, amountEdited: true })}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      testID="budget-receipt-saved"
                    />
                  </View>
                </View>
                {/*
                  THE WORKING, RIGHT-ALIGNED UNDER THE PRICE.

                  The fields above hold the member's own currency, which is
                  what gets saved. These lines show how that number was
                  reached — the printed amount and the rate — so the
                  conversion is something they can check against the paper
                  rather than take on trust. Right-aligned because they belong
                  to the money column they explain; left-aligned they read as
                  a separate remark and pull the eye away from the figures.
                */}
                <View style={styles.lineMeta}>
                  {isForeign && rate !== null && d.sourceAmountCents > 0 && (
                    <Typography
                      variant="caption2"
                      weight="semibold"
                      color={theme.pastel.teal}
                      testID="budget-receipt-line-converted"
                    >
                      {`${formatMoney(d.sourceAmountCents, receiptCurrency)} × ${formatRate(
                        rate,
                      )} = ${formatAmount(dollarsToCents(d.amount) ?? 0, {
                        decimals: 2,
                        code: displayCurrency,
                      })}`}
                    </Typography>
                  )}

                  {(dollarsToCents(d.tax) ?? 0) > 0 && (
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {isForeign && rate !== null
                        ? `incl. tax ${formatMoney(
                            d.sourceTaxCents,
                            receiptCurrency,
                          )} = ${formatAmount(dollarsToCents(d.tax) ?? 0, {
                            decimals: 2,
                            code: displayCurrency,
                          })}`
                        : `incl. ${formatMoney(
                            dollarsToCents(d.tax) ?? 0,
                            displayCurrency,
                          )} tax`}
                    </Typography>
                  )}

                  {/* Fuel bought by the gallon, priced the way the member
                      buys it. Converting only the currency leaves
                      "CA$8.43/gal", which is as unreadable as the dollars
                      were. Both conversions or neither. */}
                  {(() => {
                    const volumeUnit = normalizeVolumeUnit(d.unit);
                    const qty = d.quantity;
                    if (!volumeUnit || !qty || qty <= 0 || d.sourceAmountCents <= 0) return null;
                    const litres = toLitres(qty, volumeUnit);
                    const perLitreSource = pricePerLitre(d.sourceAmountCents, qty, volumeUnit);
                    if (perLitreSource === null) return null;
                    const shown =
                      isForeign && rate !== null
                        ? formatPerLitre(perLitreSource * rate, displayCurrency)
                        : formatPerLitre(perLitreSource, displayCurrency);
                    return (
                      <Typography
                        variant="caption2"
                        weight="semibold"
                        color={theme.pastel.teal}
                        testID="budget-receipt-per-litre"
                      >
                        {`${formatLitres(litres)} · ${shown}`}
                      </Typography>
                    );
                  })()}
                </View>
                <View style={styles.categoryField}>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    Category
                  </Typography>
                  <TouchableOpacity
                    style={[
                      styles.categoryButton,
                      { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
                    ]}
                    onPress={() => {
                      if (categories.length === 0) return;
                      setCategorySearchQuery('');
                      setCategoryPickerKey(d.key);
                    }}
                    disabled={categories.length === 0}
                    testID="budget-receipt-category"
                  >
                    {(() => {
                      const selCat =
                        categories.length > 0 && d.categoryId
                          ? categories.find((c) => c.id === d.categoryId)
                          : undefined;
                      return (
                        <View style={styles.categoryButtonInner}>
                          {selCat && (
                            <View
                              style={[
                                styles.categoryButtonIcon,
                                { backgroundColor: `${selCat.color || colors.primary}22` },
                              ]}
                            >
                              <Icon
                                name={resolveCategoryIcon(selCat)}
                                size={IconSize.md}
                                color={selCat.color || colors.primary}
                              />
                            </View>
                          )}
                          <Typography
                            variant="body"
                            color={d.categoryId ? colors.textPrimary : colors.textSecondary}
                            numberOfLines={1}
                            style={styles.categoryButtonLabel}
                          >
                            {categories.length === 0
                              ? categoriesLoaded
                                ? 'No categories available'
                                : 'Loading categories…'
                              : selCat
                                ? selCat.name
                                : 'Select category'}
                          </Typography>
                        </View>
                      );
                    })()}
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                  {d.categorySuggestions.filter((s) => s.id !== d.categoryId).length > 0 && (
                    <View style={styles.chipRowFlush} testID="budget-receipt-category-chips">
                      {d.categorySuggestions
                        .filter((s) => s.id !== d.categoryId)
                        .slice(0, 3)
                        .map((suggestion) => (
                          <Chip
                            key={suggestion.id}
                            label={suggestion.name}
                            size="sm"
                            outlined
                            testID="budget-receipt-category-chip"
                            onPress={() => updateDraft(d.key, { categoryId: suggestion.id })}
                          />
                        ))}
                    </View>
                  )}
                </View>
              </View>
            ))}

            <TouchableOpacity
              onPress={addBlankDraft}
              style={[styles.addItemRow, { borderColor: colors.borderColor }]}
              testID="budget-receipt-add-item"
            >
              <Icon name="add-circle-outline" size={20} color={theme.pastel.teal} />
              <Typography variant="caption1" weight="semibold" color={theme.pastel.teal}>
                Add item
              </Typography>
            </TouchableOpacity>

            <View style={[styles.summary, { backgroundColor: colors.backgroundSecondary }]}>
              {totals.tax > 0 && (
                <>
                  <View style={styles.summaryRow}>
                    <Typography variant="body" color={colors.textSecondary}>
                      Subtotal
                    </Typography>
                    <Typography variant="body" weight="semibold">
                      {formatMoney(totals.subtotal, displayCurrency)}
                    </Typography>
                  </View>
                  {(scan.tax_breakdown && scan.tax_breakdown.length > 0
                    ? scan.tax_breakdown
                    : [{ label: 'Tax', amount: totals.tax }]
                  ).map((line) => (
                    <View style={styles.summaryRow} key={line.label}>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {line.label}
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {formatMoney(line.amount, receiptCurrency)}
                      </Typography>
                    </View>
                  ))}
                </>
              )}
              <View style={styles.summaryRow}>
                <Typography variant="body" color={colors.textSecondary}>
                  {totals.tax > 0 ? 'Total (incl. tax)' : 'Total'}
                </Typography>
                <Typography variant="body" weight="semibold">
                  {formatMoney(totals.spent, displayCurrency)}
                </Typography>
              </View>
              {/* THE RECEIPT'S OWN TOTAL, as printed.
                  The Total above is in the member's currency because that is
                  what lands in the budget. This line is the other half they
                  need: the figure on the paper in their hand, so the import
                  can be reconciled against it without arithmetic. It carries
                  the rate too, which is the whole of the conversion in one
                  line. */}
              {isForeign && rate !== null && receiptTotalSource > 0 && (
                <View style={styles.summaryRow} testID="budget-receipt-converted-total">
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {`On the receipt (${receiptCurrency})`}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {`${formatMoney(receiptTotalSource, receiptCurrency)} × ${formatRate(rate)}`}
                  </Typography>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Typography variant="body" color={colors.textSecondary}>
                  Saved on discounts
                </Typography>
                <Typography variant="body" weight="semibold" color={colors.success}>
                  {formatMoney(totals.saved, displayCurrency)}
                </Typography>
              </View>
              {totals.deposits > 0 && (
                <View style={styles.summaryRow}>
                  <Typography variant="body" color={colors.textSecondary}>
                    Deposits
                  </Typography>
                  <Typography variant="body" weight="semibold">
                    {formatMoney(totals.deposits, displayCurrency)}
                  </Typography>
                </View>
              )}
            </View>

            <GradientButton
              title={
                isSaving
                  ? 'Adding…'
                  : missingRate
                    ? 'Enter exchange rate'
                    : totals.count > 0
                      ? `Add ${totals.count} item${totals.count > 1 ? 's' : ''}`
                      : 'Select at least one'
              }
              variant="blue"
              onPress={handleSave}
              disabled={isSaving || totals.count === 0 || missingRate}
              fullWidth
              style={styles.addButton}
              testID="budget-receipt-save"
            />
          </>
        )}
      </ScrollView>

      <CloudFilePicker
        visible={showDrivePicker}
        provider="google-drive"
        mimeTypeFilter={[...RECEIPT_MIMES]}
        rememberScope="receipts"
        onClose={() => setShowDrivePicker(false)}
        onFileSelected={handleDriveFileSelected}
      />

      <Modal
        visible={showCurrencyPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <View style={[styles.categoryModalOverlay, { backgroundColor: colors.modalBackdrop }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowCurrencyPicker(false)}
            accessibilityLabel="Close currency picker"
          />
          <View style={[styles.categoryModalSheet, { backgroundColor: colors.backgroundMain }]}>
            <OverlaySheetHeader
              title="Receipt currency"
              onClose={() => setShowCurrencyPicker(false)}
              closeTestID="budget-receipt-currency-close"
            />
            <ScrollView style={styles.categoryModalList} showsVerticalScrollIndicator>
              {SUPPORTED_CURRENCIES.map((option) => (
                <TouchableOpacity
                  key={option.code}
                  style={[styles.categoryOption, { borderBottomColor: colors.divider }]}
                  onPress={() => {
                    setReceiptCurrency(option.code);
                    // Remember that this was ASKED FOR, so a scan that follows
                    // does not quietly replace it with its own inference.
                    setCurrencyOverride(option.code);
                    setShowCurrencyPicker(false);
                  }}
                  testID={`budget-receipt-currency-${option.code}`}
                >
                  <View style={styles.currencyOptionLeft}>
                    <Typography variant="body" style={styles.currencyOptionSymbol}>
                      {`${option.flag}  ${option.symbol}`}
                    </Typography>
                    <Typography variant="body">{`${option.label} (${option.code})`}</Typography>
                  </View>
                  {option.code === receiptCurrency && (
                    <Icon name="checkmark" size={18} color={theme.pastel.teal} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={categoryPickerKey !== null}
        transparent
        animationType="slide"
        onRequestClose={closeCategoryPicker}
      >
        <View
          style={[
            styles.categoryModalOverlay,
            { backgroundColor: colors.modalBackdrop },
            // The search field sits in a bottom-anchored sheet, so the keypad it
            // summons lands on top of the results below it. Lift by the measured
            // inset — a KeyboardAvoidingView is unreliable inside a Modal, and
            // `categoryModalSheet`'s percentage maxHeight shrinks with the
            // padding so the sheet never runs off the top.
            { paddingBottom: keyboardInset },
          ]}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeCategoryPicker}
            accessibilityLabel="Close category picker"
          />
          <View style={[styles.categoryModalSheet, { backgroundColor: colors.backgroundMain }]}>
            <OverlaySheetHeader
              title="Select category"
              onClose={closeCategoryPicker}
              closeTestID="budget-receipt-category-close"
            />

            <View
              style={[
                styles.searchContainer,
                { backgroundColor: colors.backgroundSecondary, borderColor: colors.borderColor },
              ]}
            >
              <Icon name="search" size={18} color={colors.textTertiary} />
              <RNTextInput
                ref={categorySearchInputRef}
                testID="budget-receipt-category-search"
                style={[styles.searchInput, { color: colors.textPrimary }]}
                value={categorySearchQuery}
                onChangeText={setCategorySearchQuery}
                placeholder="Search or name a new category..."
                placeholderTextColor={colors.textTertiary}
              />
              {categorySearchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setCategorySearchQuery('')}>
                  <Icon name="close-circle" size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>

            <BudgetCategoryCreateRow
              query={categorySearchQuery}
              categories={categories}
              isCreating={isCreatingCategory}
              onCreate={createCategory}
              onNeedsName={() => categorySearchInputRef.current?.focus()}
              rowTestID="budget-receipt-category-create"
            />

            <ScrollView
              style={styles.categoryModalList}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator
            >
              <TouchableOpacity
                style={[styles.categoryOption, { borderBottomColor: colors.divider }]}
                onPress={() => {
                  if (categoryPickerKey) updateDraft(categoryPickerKey, { categoryId: undefined });
                  closeCategoryPicker();
                }}
                testID="budget-receipt-category-none"
              >
                <Typography variant="body" color={colors.textSecondary}>
                  No category
                </Typography>
              </TouchableOpacity>

              {filteredCategories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryOption, { borderBottomColor: colors.divider }]}
                  onPress={() => {
                    if (categoryPickerKey) updateDraft(categoryPickerKey, { categoryId: cat.id });
                    closeCategoryPicker();
                  }}
                  testID={`budget-receipt-category-${cat.id}`}
                >
                  <View style={styles.categoryOptionLeft}>
                    <View
                      style={[
                        styles.categoryOptionIcon,
                        { backgroundColor: `${cat.color || colors.primary}22` },
                      ]}
                    >
                      <Icon
                        name={resolveCategoryIcon(cat)}
                        size={IconSize.lg}
                        color={cat.color || colors.primary}
                      />
                    </View>
                    <Typography variant="body" color={colors.textPrimary}>
                      {cat.name}
                    </Typography>
                  </View>
                </TouchableOpacity>
              ))}

              {filteredCategories.length === 0 && (
                <View style={styles.noResults}>
                  <Typography variant="body" color={colors.textSecondary}>
                    No categories found
                  </Typography>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Blocks the screen while the receipt is read so no source is tapped
          twice and the member can't leave with the scan in flight. The stage
          copy is what keeps a 30s AI read from looking hung. */}
      <ProcessingOverlay visible={isScanning} {...scanOverlayCopy(scanStage)} />
    </SafeAreaView>
    </AppBackground>
    </AIAccessGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  attachmentName: { flex: 1 },
  attachmentList: { gap: 8 },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  noticeText: { flex: 1, lineHeight: 18 },
  taxHint: { marginTop: -4, marginLeft: 2 },
  // The working belongs to the money column it explains, so it sits under it
  // rather than starting back at the card's left edge.
  lineMeta: { alignItems: 'flex-end', gap: 2, marginTop: -2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  reviewLabel: { marginTop: 4, marginBottom: -4 },
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameField: { flex: 1 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingLeft: 32,
  },
  /** Tax pill + fee pills on one line — the line's facts, read left to right. */
  factRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 32,
  },
  factRowInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chipRowFlush: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  priceRow: { flexDirection: 'row', gap: 10, paddingLeft: 32 },
  priceField: { flex: 1 },
  categoryField: { paddingLeft: 32, gap: 6 },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryButtonLabel: { flex: 1 },
  categoryButtonInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryButtonIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  summary: {
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  addButton: { marginTop: 4 },
  categoryModalOverlay: { flex: 1, justifyContent: 'flex-end' },
  categoryModalSheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  categoryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, padding: 0 },
  categoryModalList: { flexGrow: 0 },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  currencyOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  // Fixed width so the codes line up down the list however wide the glyph is
  // ("$" next to "CHF" ragged left is most of what makes a picker look untidy).
  currencyOptionSymbol: { width: 76 },
  currencyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  currencyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 130,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rateField: { flex: 1 },
  detectedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  foreignPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  applyButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  categoryOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noResults: { paddingVertical: 24, alignItems: 'center' },
});
