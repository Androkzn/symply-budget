import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { HealthFridgeMeal, HealthFridgeMealPlan } from '@api/healthFridge';
import { CloudFilePicker } from '@components/cloud-storage';
import { ProcessingOverlay, ScanImportSources } from '@components/common';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import ImageCropPicker from '@services/image-picker-compat';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

import { HealthSectionScreen, HealthStatTiles } from '../components';
import {
  addFridgeItems,
  createFridgeItem,
  deleteFridgeItem,
  DEFAULT_FRIDGE_CATEGORY,
  DEFAULT_FRIDGE_UNIT,
  EMPTY_FRIDGE_DRAFT,
  EXPIRING_SOON_DAYS,
  EXPIRY_QUICK_PICKS,
  expiringWithin,
  expiryBucketOf,
  formatExpiry,
  formatQuantity,
  FRIDGE_CATEGORIES,
  FRIDGE_FILTER_LABELS,
  FRIDGE_FILTERS,
  FRIDGE_UNITS,
  groupByExpiry,
  loadExpiringSoon,
  loadFridge,
  loadFridgeMealIdeas,
  lookupFridgeBarcode,
  parseExpiryInput,
  parseQuantityInput,
  quickPickDate,
  receiptRowToDraft,
  sanitizeBarcodeInput,
  sanitizeQuantityInput,
  scanFridgeReceipt,
  setFridgeFavorite,
  summarizeFridge,
  updateFridgeItem,
  viewFridge,
  type FridgeDraft,
  type FridgeFilter,
  type FridgeItem,
  type FridgeWriteResult,
  type ReceiptDraftRow,
} from '../healthFridgeStorage';
import { maskDayKeyInput, todayDateKey } from '../healthLocalStorage';
import {
  HEALTH_VISION_MIMES,
  toVisionSafeBase64,
  type HealthPickedImage,
} from '../healthVisionAttachments';

/**
 * Fridge tab — the donor's "Smart Fridge", rebuilt on the deployed
 * `/health/fridge` routes.
 *
 * ## What this screen refuses to round off
 *
 * The deployed expiring-soon window is INCLUSIVE OF THE PAST and EXCLUDES
 * undated items (see `healthFridgeStorage`). Both facts are surfaced rather
 * than smoothed over:
 *
 *  - expired stock is its own group, ordered FIRST and longest-expired first,
 *    never merged into "this week" and never hidden;
 *  - undated items get a named group whose hint says outright that they are
 *    invisible to the expiring-soon count;
 *  - the summary card prints the actual cutoff date it counted to, so the
 *    number is checkable rather than magic.
 *
 * ## The three donor capabilities (parity P5)
 *
 * Barcode lookup, receipt reading and meal ideas used to be listed here as
 * "deliberately absent — no route on this Worker". All three have routes now,
 * and each is presented with its own limits stated rather than smoothed over:
 *
 *  - **Barcode.** The digits are TYPED. This app has no camera barcode reader —
 *    there is no scanning dependency in the build — and a card that opened a
 *    camera which then did nothing would be worse than a number field. The
 *    lookup itself is a FatSecret database call, which is not switched on for
 *    any deploy yet, so the honest common case is "not switched on" and the
 *    card says exactly that instead of failing.
 *  - **Receipt.** The same reader Budget uses, so the item names arrive already
 *    grouped ("Tomatoes", not "KUMATO TOMATO 340G"). Nothing is saved until the
 *    person has ticked the rows. Non-food lines are SHOWN but unticked, and the
 *    suggested expiry is a published typical shelf life, never something read
 *    off the receipt — the card says so in words.
 *  - **Meal ideas.** Read and gone; nothing is stored. Macros are labelled as
 *    estimates, and there is no one-tap "log this meal" — the donor had one and
 *    it wrote a model's guess straight into the food diary.
 *
 * Every one of the three can be switched off, unpaid for or unreachable, and
 * every one of those states resolves to a sentence in the message card. No
 * provider string, no status code, no spinner that never stops.
 */

/** Draft rendered as text — parsing happens on save, not on every keystroke. */
interface FridgeForm {
  name: string;
  quantity: string;
  unit: string;
  category: string;
  expiry: string;
  notes: string;
  isFavorite: boolean;
}

/**
 * Frames one receipt scan may carry. Matches the Worker's `MAX_VISION_IMAGES`,
 * and they are read as ONE long receipt in order — not as four receipts.
 */
const MAX_RECEIPT_SHOTS = 4;

const EMPTY_FORM: FridgeForm = {
  name: '',
  quantity: '',
  unit: DEFAULT_FRIDGE_UNIT,
  category: DEFAULT_FRIDGE_CATEGORY,
  expiry: '',
  notes: '',
  isFavorite: false,
};

function formFor(item: FridgeItem): FridgeForm {
  return {
    name: item.name,
    quantity: item.quantity === null ? '' : String(item.quantity),
    unit: item.unit ?? DEFAULT_FRIDGE_UNIT,
    category: item.category || DEFAULT_FRIDGE_CATEGORY,
    expiry: item.expiryDate ?? '',
    notes: item.notes,
    isFavorite: item.isFavorite,
  };
}

export function HealthFridgeScreen() {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();

  const [items, setItems] = useState<FridgeItem[]>([]);
  /**
   * The rows the DEPLOYED `?expiring_within_days=7` window returns, not a
   * lookalike computed here. After a write we re-derive them with
   * `expiringWithin` — the proven-identical local twin — so the card stays
   * consistent with what the user just did without a second round trip.
   */
  const [expiring, setExpiring] = useState<FridgeItem[]>([]);
  const [filter, setFilter] = useState<FridgeFilter>('all');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FridgeForm>({ ...EMPTY_FORM });
  /**
   * The two draft fields the FORM does not own — `source` and the macros a
   * barcode brought with it. Held beside the form rather than inside it because
   * they are not editable text, and they must ride along on a CREATE and be
   * left alone on an EDIT (an omitted key on the PUT means "keep what you have";
   * see `toWireFridgePayload`).
   */
  const [pendingExtras, setPendingExtras] = useState<Pick<
    FridgeDraft,
    'source' | 'nutrition'
  > | null>(null);

  /* -- barcode -- */
  const [barcode, setBarcode] = useState('');
  const [barcodeBusy, setBarcodeBusy] = useState(false);

  /* -- receipt -- */
  const [shots, setShots] = useState<HealthPickedImage[]>([]);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptRows, setReceiptRows] = useState<ReceiptDraftRow[]>([]);
  const [receiptVendor, setReceiptVendor] = useState<string | null>(null);
  /** Per row: apply the typical shelf life, or leave the item undated. */
  const [useTypicalExpiry, setUseTypicalExpiry] = useState<Record<string, boolean>>({});
  const [savingReceipt, setSavingReceipt] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);

  /* -- meal ideas -- */
  const [mealPlan, setMealPlan] = useState<HealthFridgeMealPlan | null>(null);
  const [mealsBusy, setMealsBusy] = useState(false);

  const today = todayDateKey();

  const setField = useCallback(<K extends keyof FridgeForm>(key: K, value: FridgeForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const hydrate = useCallback(async (day: string) => {
    const [all, soon] = await Promise.all([
      loadFridge(),
      loadExpiringSoon(EXPIRING_SOON_DAYS, day),
    ]);
    setItems(all);
    setExpiring(soon);
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate(today);
  }, [hydrate, today]);

  const summary = useMemo(() => summarizeFridge(items, today), [items, today]);

  /** Urgency split of the SERVER's window, so the card and the rows agree. */
  const windowCounts = useMemo(() => {
    const counts = { expired: 0, dueToday: 0, dueThisWeek: 0 };
    for (const entry of expiring) {
      const bucket = expiryBucketOf(entry.expiryDate, today);
      if (bucket === 'expired') counts.expired += 1;
      else if (bucket === 'today') counts.dueToday += 1;
      else if (bucket === 'week') counts.dueThisWeek += 1;
    }
    return counts;
  }, [expiring, today]);

  const visible = useMemo(() => {
    // The expiring view IS the server's window; only search narrows it further.
    if (filter === 'expiring') return viewFridge(expiring, { filter: 'all', query, today });
    return viewFridge(items, { filter, query, today });
  }, [items, expiring, filter, query, today]);
  const groups = useMemo(() => groupByExpiry(visible, today), [visible, today]);
  const selectedReceiptCount = useMemo(
    () => receiptRows.filter((row) => row.selected).length,
    [receiptRows]
  );

  const parsedQuantity = parseQuantityInput(form.quantity);
  const parsedExpiry = parseExpiryInput(form.expiry);
  const canSave = form.name.trim().length > 0 && parsedQuantity.valid && parsedExpiry.valid;
  const searching = query.trim().length > 0;

  const apply = useCallback(
    (result: FridgeWriteResult) => {
      setItems(result.items);
      setExpiring(expiringWithin(result.items, EXPIRING_SOON_DAYS, today));
      setMessage(result.message);
      return result;
    },
    [today]
  );

  const resetForm = useCallback(() => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setPendingExtras(null);
  }, []);

  const handleSave = async () => {
    if (!canSave || !parsedQuantity.valid || !parsedExpiry.valid) return;
    const draft: FridgeDraft = {
      ...EMPTY_FRIDGE_DRAFT,
      name: form.name,
      quantity: parsedQuantity.quantity,
      unit: form.unit,
      category: form.category,
      expiryDate: parsedExpiry.date,
      notes: form.notes,
      isFavorite: form.isFavorite,
      // Only on a CREATE. Sending them on the PUT would overwrite the source of
      // an item that came from a receipt with whatever the form last held.
      ...(editingId === null && pendingExtras !== null ? pendingExtras : {}),
    };
    const result = apply(
      editingId ? await updateFridgeItem(editingId, draft) : await createFridgeItem(draft)
    );
    if (result.status !== 'rejected') resetForm();
  };

  const handleEdit = (item: FridgeItem) => {
    setEditingId(item.id);
    setMessage(null);
    setPendingExtras(null);
    setForm(formFor(item));
  };

  /* ================================================================== */
  /* Barcode                                                            */
  /* ================================================================== */

  /**
   * Look the code up and, on a hit, LOAD THE ADD FORM rather than saving.
   *
   * A barcode identifies a product, not the tin in this person's hand: it
   * carries no expiry, no count, and a name that is often a marketing name. So
   * it fills the form the person was going to use anyway and they press Add —
   * one review step, the same one the receipt and scan surfaces keep.
   */
  const handleBarcodeLookup = async () => {
    const code = sanitizeBarcodeInput(barcode);
    if (code.length === 0 || barcodeBusy) return;
    setBarcodeBusy(true);
    setMessage(null);
    const result = await lookupFridgeBarcode(code);
    setBarcodeBusy(false);

    if (result.status !== 'found' || result.draft === null) {
      setMessage(result.message);
      return;
    }
    const draft = result.draft;
    setEditingId(null);
    setPendingExtras({ source: draft.source, nutrition: draft.nutrition });
    setForm({
      name: draft.name,
      quantity: draft.quantity === null ? '' : String(draft.quantity),
      unit: draft.unit,
      category: draft.category,
      expiry: '',
      notes: draft.notes,
      isFavorite: false,
    });
    setBarcode('');
    setMessage(
      `Found ${draft.name}. Check it, set an expiry date if you want one, then add it to your fridge.`
    );
  };

  /* ================================================================== */
  /* Receipt                                                            */
  /* ================================================================== */

  const addShot = (shot: HealthPickedImage) =>
    setShots((prev) => (prev.length >= MAX_RECEIPT_SHOTS ? prev : [...prev, shot]));

  const handleCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      addShot({ uri: image.path, name: image.filename ?? 'receipt.jpg' });
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        setMessage('The camera could not be opened.');
      }
    }
  };

  const handleGallery = async () => {
    try {
      const picked = await ImageCropPicker.openPicker({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
        multiple: true,
      });
      for (const image of Array.isArray(picked) ? picked : [picked]) {
        addShot({ uri: image.path, name: image.filename ?? 'receipt.jpg' });
      }
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        setMessage('The photo library could not be opened.');
      }
    }
  };

  const handleFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...HEALTH_VISION_MIMES],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      for (const asset of result.assets) {
        addShot({ uri: asset.uri, name: asset.name ?? 'receipt.jpg' });
      }
    } catch {
      setMessage('The file picker could not be opened.');
    }
  };

  const clearReceipt = useCallback(() => {
    setShots([]);
    setReceiptRows([]);
    setReceiptVendor(null);
    setUseTypicalExpiry({});
  }, []);

  const handleReadReceipt = async () => {
    if (shots.length === 0 || receiptBusy) return;
    setReceiptBusy(true);
    setMessage(null);
    setReceiptRows([]);
    try {
      const images = await Promise.all(shots.map(toVisionSafeBase64));
      const result = await scanFridgeReceipt(images, today);
      if (result.status !== 'ok') {
        setMessage(result.message);
        return;
      }
      setReceiptRows(result.rows);
      setReceiptVendor(result.vendor);
      setShots([]);
      if (result.rows.length === 0) {
        setMessage('Nothing on that receipt looked like something for your fridge.');
      }
    } catch {
      // Reading the file off disk / re-encoding it failed — never the model.
      setMessage('That photo could not be prepared for reading. Try a different one.');
    } finally {
      setReceiptBusy(false);
    }
  };

  const toggleRow = (key: string) =>
    setReceiptRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, selected: !row.selected } : row))
    );

  const expiryFor = useCallback(
    (row: ReceiptDraftRow) => useTypicalExpiry[row.key] ?? row.suggestedExpiryDate !== null,
    [useTypicalExpiry]
  );

  const handleAddReceiptItems = async () => {
    const chosen = receiptRows.filter((row) => row.selected);
    if (chosen.length === 0 || savingReceipt) return;
    setSavingReceipt(true);
    const result = await addFridgeItems(
      chosen.map((row) => receiptRowToDraft(row, expiryFor(row) ? row.suggestedExpiryDate : null))
    );
    setSavingReceipt(false);
    apply(result);
    if (result.status !== 'rejected') clearReceipt();
  };

  /* ================================================================== */
  /* Meal ideas                                                         */
  /* ================================================================== */

  const handleMealIdeas = async () => {
    if (mealsBusy) return;
    setMealsBusy(true);
    setMessage(null);
    setMealPlan(null);
    const result = await loadFridgeMealIdeas({ today });
    setMealsBusy(false);
    if (result.status !== 'ok' || result.plan === null) {
      setMessage(result.message);
      return;
    }
    setMealPlan(result.plan);
  };

  const handleFavorite = async (item: FridgeItem) => {
    apply(await setFridgeFavorite(item.id, !item.isFavorite));
  };

  const handleDelete = (item: FridgeItem) => {
    Alert.alert('Remove item', `Take "${item.name}" out of your fridge?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void deleteFridgeItem(item.id).then((result) => {
            apply(result);
            if (editingId === item.id) resetForm();
          });
        },
      },
    ]);
  };

  const cardStyle = [styles.card, { backgroundColor: colors.backgroundSecondary }];
  const inputStyle = [
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.borderColor,
      backgroundColor: colors.backgroundMain,
    },
  ];

  return (
    <HealthSectionScreen title="Fridge" testID="health-fridge-screen" loading={loading}>
      {/* ONE overlay for every blocking call on this screen. The shared
          primitive, never a per-surface spinner. */}
      <ProcessingOverlay
        visible={receiptBusy || mealsBusy || barcodeBusy}
        message={
          receiptBusy
            ? 'Reading that receipt…'
            : mealsBusy
              ? 'Looking at what you have…'
              : 'Looking that barcode up…'
        }
        caption={barcodeBusy ? 'Checking the food database' : 'Working it out with AI'}
        testID="health-fridge-overlay"
      />

      {/* What needs eating — the deployed window, stated in full */}
      <Card variant="filled" style={cardStyle}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          NEEDS EATING
        </Typography>
        <HealthStatTiles
          stats={[
            {
              label: 'Expired',
              value: String(windowCounts.expired),
              icon: 'overdue',
              testID: 'health-fridge-stat-expired',
            },
            {
              label: 'Use today',
              value: String(windowCounts.dueToday),
              icon: 'due',
              testID: 'health-fridge-stat-today',
            },
            {
              label: 'Next 7 days',
              value: String(windowCounts.dueThisWeek),
              icon: 'calendar',
              testID: 'health-fridge-stat-week',
            },
          ]}
        />
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="health-fridge-window-note"
        >
          {`Expiring soon counts ${expiring.length} of ${summary.total} items — everything dated on or before ${summary.cutoff}, including ${windowCounts.expired} already past their date. ${
            summary.undated === 0
              ? 'Undated items are never counted.'
              : `${summary.undated} undated ${summary.undated === 1 ? 'item is' : 'items are'} never counted.`
          }`}
        </Typography>
      </Card>

      {/* What to cook with it — read and gone, nothing stored */}
      <Card variant="filled" style={cardStyle} testID="health-fridge-meals-card">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT COULD I COOK
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          Ideas built around whatever is closest to its date. Nothing is saved, and the calorie
          figures are estimates for a dish nobody has weighed yet.
        </Typography>
        <Pressable
          onPress={() => void handleMealIdeas()}
          disabled={mealsBusy || summary.total === 0}
          accessibilityRole="button"
          accessibilityLabel="Suggest meals from my fridge"
          accessibilityState={{ disabled: mealsBusy || summary.total === 0 }}
          testID="health-fridge-meals-run"
          style={[
            styles.addButton,
            {
              backgroundColor:
                mealsBusy || summary.total === 0 ? colors.borderColor : colors.primary,
            },
          ]}
        >
          <Icon name="meals" size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            Suggest meals
          </Typography>
        </Pressable>
        {summary.total === 0 && (
          <Typography variant="caption1" color={colors.textSecondary}>
            Add something to your fridge first — there is nothing to cook from yet.
          </Typography>
        )}
        {mealPlan !== null && <MealPlanCards plan={mealPlan} />}
      </Card>

      {/* Search + filter */}
      <Card variant="filled" style={cardStyle}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          FIND
        </Typography>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name or category"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search your fridge"
            testID="health-fridge-search-input"
            style={[...inputStyle, styles.flexInput]}
          />
          {searching && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="health-fridge-search-clear"
              style={[styles.iconButton, { borderColor: colors.borderColor }]}
            >
              <Icon name="close" size={18} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
        <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
          {FRIDGE_FILTERS.map((option) => {
            const active = option === filter;
            return (
              <Pressable
                key={option}
                onPress={() => setFilter(option)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${FRIDGE_FILTER_LABELS[option]}`}
                accessibilityState={{ selected: active }}
                testID={`health-fridge-filter-${option}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {FRIDGE_FILTER_LABELS[option]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
        {filter === 'expiring' && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-fridge-filter-note"
          >
            {`Dated on or before ${summary.cutoff}, expired stock first. Items with no date are not in this view.`}
          </Typography>
        )}
      </Card>

      {message && (
        <Card variant="filled" style={cardStyle} testID="health-fridge-message">
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* Barcode — a database lookup, not a camera. Says so. */}
      <Card variant="filled" style={cardStyle} testID="health-fridge-barcode-card">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          BARCODE
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          Type the digits printed under the bars. A match fills in the name and the nutrition
          below — a barcode never carries an expiry date, so set that yourself.
        </Typography>
        <View style={styles.searchRow}>
          <TextInput
            value={barcode}
            onChangeText={(text) => setBarcode(sanitizeBarcodeInput(text))}
            placeholder="e.g. 5000112637922"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            returnKeyType="search"
            onSubmitEditing={() => void handleBarcodeLookup()}
            accessibilityLabel="Barcode digits"
            testID="health-fridge-barcode-input"
            style={[...inputStyle, styles.flexInput]}
          />
          <Pressable
            onPress={() => void handleBarcodeLookup()}
            disabled={barcode.length === 0 || barcodeBusy}
            accessibilityRole="button"
            accessibilityLabel="Look up this barcode"
            accessibilityState={{ disabled: barcode.length === 0 || barcodeBusy }}
            testID="health-fridge-barcode-lookup"
            style={[
              styles.lookupButton,
              {
                backgroundColor:
                  barcode.length === 0 || barcodeBusy ? colors.borderColor : colors.primary,
              },
            ]}
          >
            <Icon name="barcode" size={16} color={colors.white} />
            <Typography variant="caption1" weight="semibold" color={colors.white}>
              Look up
            </Typography>
          </Pressable>
        </View>
      </Card>

      {/* Receipt — the shared reader, the shared picker row */}
      <Card variant="filled" style={cardStyle} testID="health-fridge-receipt-card">
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          FROM A RECEIPT
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          Photograph your shopping receipt and tick what belongs in the fridge. Nothing is added
          until you say so.
        </Typography>

        {/* The shared Camera / Gallery / File / Drive row — never re-forked. */}
        <ScanImportSources
          onCamera={() => void handleCamera()}
          onGallery={() => void handleGallery()}
          onFile={() => void handleFile()}
          onDrive={() => setShowDrivePicker(true)}
          disabled={receiptBusy || shots.length >= MAX_RECEIPT_SHOTS}
          testIDPrefix="health-fridge-receipt"
        />

        {shots.length > 0 && (
          <View style={styles.shotList} testID="health-fridge-receipt-shots">
            {shots.map((shot, index) => (
              <View
                key={`${shot.uri}-${index}`}
                style={[styles.itemRow, { borderTopColor: colors.borderColor }]}
              >
                <Icon name="review-draft" size={16} color={colors.textSecondary} />
                <Typography variant="caption1" color={colors.textPrimary} style={styles.itemText}>
                  {shot.name}
                </Typography>
                <Pressable
                  onPress={() => setShots((prev) => prev.filter((_, i) => i !== index))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${shot.name}`}
                  testID={`health-fridge-receipt-remove-${index}`}
                >
                  <Typography variant="caption1" weight="semibold" color={colors.error}>
                    Remove
                  </Typography>
                </Pressable>
              </View>
            ))}
            <Typography variant="caption2" color={colors.textSecondary}>
              {shots.length === MAX_RECEIPT_SHOTS
                ? `That is the most this can read at once (${MAX_RECEIPT_SHOTS}).`
                : `${shots.length} of ${MAX_RECEIPT_SHOTS} images. All of them are read as ONE long receipt, in order.`}
            </Typography>
          </View>
        )}

        <Pressable
          onPress={() => void handleReadReceipt()}
          disabled={shots.length === 0 || receiptBusy}
          accessibilityRole="button"
          accessibilityLabel="Read this receipt"
          accessibilityState={{ disabled: shots.length === 0 || receiptBusy }}
          testID="health-fridge-receipt-run"
          style={[
            styles.addButton,
            {
              backgroundColor:
                shots.length === 0 || receiptBusy ? colors.borderColor : colors.primary,
            },
          ]}
        >
          <Icon name="review-draft" size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            Read this receipt
          </Typography>
        </Pressable>
      </Card>

      {/* Receipt review — nothing above this has been saved */}
      {receiptRows.length > 0 && (
        <Card variant="filled" style={cardStyle} testID="health-fridge-receipt-review">
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {receiptVendor ? `FROM ${receiptVendor.toUpperCase()}` : 'WHAT WAS ON THE RECEIPT'}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            Nothing is saved yet. Anything that did not look like food is left unticked — tick it
            if it belongs in your fridge. Expiry dates are TYPICAL shelf lives for the category,
            not something printed on the receipt.
          </Typography>

          {receiptRows.map((row) => (
            <ReceiptRow
              key={row.key}
              row={row}
              useTypical={expiryFor(row)}
              onToggleSelected={() => toggleRow(row.key)}
              onToggleExpiry={() =>
                setUseTypicalExpiry((prev) => ({ ...prev, [row.key]: !expiryFor(row) }))
              }
            />
          ))}

          <View style={styles.formActions}>
            <Pressable
              onPress={() => void handleAddReceiptItems()}
              disabled={selectedReceiptCount === 0 || savingReceipt}
              accessibilityRole="button"
              accessibilityLabel="Add the ticked items to my fridge"
              accessibilityState={{ disabled: selectedReceiptCount === 0 || savingReceipt }}
              testID="health-fridge-receipt-save"
              style={[
                styles.primaryButton,
                {
                  backgroundColor:
                    selectedReceiptCount === 0 || savingReceipt
                      ? colors.borderColor
                      : colors.primary,
                },
              ]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.white}>
                {selectedReceiptCount === 0
                  ? 'Nothing ticked'
                  : `Add ${selectedReceiptCount} ${selectedReceiptCount === 1 ? 'item' : 'items'}`}
              </Typography>
            </Pressable>
            <Pressable
              onPress={clearReceipt}
              accessibilityRole="button"
              accessibilityLabel="Discard this receipt"
              testID="health-fridge-receipt-discard"
              style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
            >
              <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
                Discard
              </Typography>
            </Pressable>
          </View>
        </Card>
      )}

      {/* Add / edit */}
      <Card variant="filled" style={cardStyle}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editingId ? 'EDIT ITEM' : 'ADD AN ITEM'}
          </Typography>
          {editingId && (
            <Pressable
              onPress={resetForm}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              testID="health-fridge-cancel-edit"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Cancel
              </Typography>
            </Pressable>
          )}
        </View>

        <TextInput
          value={form.name}
          onChangeText={(text) => setField('name', text)}
          placeholder="Item name"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Item name"
          testID="health-fridge-name-input"
          style={inputStyle}
        />

        <View style={styles.row}>
          <TextInput
            value={form.quantity}
            onChangeText={(text) => setField('quantity', sanitizeQuantityInput(text))}
            placeholder="Quantity (optional)"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            accessibilityLabel="Quantity"
            testID="health-fridge-quantity-input"
            style={[...inputStyle, styles.flexInput]}
          />
        </View>
        {!parsedQuantity.valid && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-fridge-quantity-hint"
          >
            Enter a number up to 1,000,000, or leave it blank for no quantity.
          </Typography>
        )}

        <View style={styles.chipRow}>
          {FRIDGE_UNITS.map((unit) => {
            const active = unit === form.unit;
            return (
              <Pressable
                key={unit}
                onPress={() => setField('unit', unit)}
                accessibilityRole="button"
                accessibilityLabel={`Unit ${unit}`}
                accessibilityState={{ selected: active }}
                testID={`health-fridge-unit-${unit}`}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {unit}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.chipRow}>
          {FRIDGE_CATEGORIES.map((category) => {
            const active = category === form.category;
            return (
              <Pressable
                key={category}
                onPress={() => setField('category', category)}
                accessibilityRole="button"
                accessibilityLabel={`Category ${category}`}
                accessibilityState={{ selected: active }}
                testID={`health-fridge-category-${category}`}
                style={[
                  styles.chip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {category}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        <TextInput
          value={form.expiry}
          onChangeText={(text) => setField('expiry', maskDayKeyInput(text))}
          placeholder="Expiry date (YYYY-MM-DD)"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel="Expiry date"
          testID="health-fridge-expiry-input"
          style={inputStyle}
        />
        <View style={styles.chipRow}>
          {EXPIRY_QUICK_PICKS.map((pick) => (
            <Pressable
              key={pick.id}
              onPress={() => setField('expiry', quickPickDate(pick.days, today) ?? '')}
              accessibilityRole="button"
              accessibilityLabel={`Expires ${pick.label}`}
              testID={`health-fridge-expiry-${pick.id}`}
              style={[styles.chip, { borderColor: colors.borderColor }]}
            >
              <Typography variant="caption1" weight="semibold" color={colors.textSecondary}>
                {pick.label}
              </Typography>
            </Pressable>
          ))}
        </View>
        {!parsedExpiry.valid && (
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-fridge-expiry-hint"
          >
            Enter the date as YYYY-MM-DD, or leave it blank for no date.
          </Typography>
        )}

        <TextInput
          value={form.notes}
          onChangeText={(text) => setField('notes', text)}
          placeholder="Notes (optional)"
          placeholderTextColor={colors.textSecondary}
          multiline
          accessibilityLabel="Notes"
          testID="health-fridge-notes-input"
          style={[...inputStyle, styles.notesInput]}
        />

        <Pressable
          onPress={() => setField('isFavorite', !form.isFavorite)}
          accessibilityRole="switch"
          accessibilityLabel="Favourite"
          accessibilityState={{ checked: form.isFavorite, selected: form.isFavorite }}
          testID="health-fridge-favorite-toggle"
          style={styles.toggleRow}
        >
          <Icon
            name={form.isFavorite ? 'star' : 'star-outline'}
            size={18}
            color={form.isFavorite ? colors.primary : colors.textSecondary}
          />
          <Typography variant="body" color={colors.textPrimary}>
            {form.isFavorite ? 'Favourite' : 'Mark as favourite'}
          </Typography>
        </Pressable>

        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? 'Save item' : 'Add item'}
          accessibilityState={{ disabled: !canSave }}
          testID="health-fridge-save-button"
          style={[styles.addButton, { backgroundColor: canSave ? colors.primary : colors.borderColor }]}
        >
          <Icon name={editingId ? 'complete' : 'add'} size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            {editingId ? 'Save changes' : 'Add to fridge'}
          </Typography>
        </Pressable>
      </Card>

      {/* The fridge itself, grouped by urgency */}
      {groups.length === 0 ? (
        <Card variant="filled" style={cardStyle}>
          <Typography variant="body" color={colors.textSecondary} testID="health-fridge-empty">
            {emptyCopy({ total: summary.total, filter, searching, cutoff: summary.cutoff })}
          </Typography>
        </Card>
      ) : (
        groups.map((group) => (
          <Card
            key={group.bucket}
            variant="filled"
            style={cardStyle}
            testID={`health-fridge-group-${group.bucket}`}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              {group.label.toUpperCase()} · {group.items.length}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {group.hint}
            </Typography>
            {group.items.map((item) => (
              <View
                key={item.id}
                style={[styles.itemRow, { borderTopColor: colors.borderColor }]}
                testID={`health-fridge-item-${item.id}`}
              >
                <Pressable
                  onPress={() => void handleFavorite(item)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    item.isFavorite ? `Unfavourite ${item.name}` : `Favourite ${item.name}`
                  }
                  accessibilityState={{ selected: item.isFavorite }}
                  testID={`health-fridge-favorite-${item.id}`}
                  hitSlop={8}
                >
                  <Icon
                    name={item.isFavorite ? 'star' : 'star-outline'}
                    size={18}
                    color={item.isFavorite ? colors.primary : colors.textSecondary}
                  />
                </Pressable>
                <View style={styles.itemText}>
                  <Typography variant="body" color={colors.textPrimary}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {[formatQuantity(item.quantity, item.unit), item.category]
                      .filter((part) => part.length > 0)
                      .join(' · ')}
                  </Typography>
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    testID={`health-fridge-expiry-label-${item.id}`}
                  >
                    {formatExpiry(item.expiryDate, today)}
                  </Typography>
                  {/* Macros a barcode brought with it. Shown WITH the serving
                      they describe — four bare numbers are unreadable. */}
                  {item.nutrition !== null && (
                    <Typography
                      variant="caption2"
                      color={colors.textSecondary}
                      testID={`health-fridge-nutrition-${item.id}`}
                    >
                      {`${Math.round(item.nutrition.calories)} kcal per ${item.nutrition.portion} ${item.nutrition.unit}`}
                    </Typography>
                  )}
                  {item.notes.length > 0 && (
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {item.notes}
                    </Typography>
                  )}
                </View>
                <Pressable
                  onPress={() => handleEdit(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${item.name}`}
                  testID={`health-fridge-edit-${item.id}`}
                  hitSlop={8}
                >
                  <Icon name="edit" size={16} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
                  testID={`health-fridge-delete-${item.id}`}
                  hitSlop={8}
                >
                  <Icon name="delete" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))}
          </Card>
        ))
      )}

      {showDrivePicker && (
        <CloudFilePicker
          visible={showDrivePicker}
          provider="google-drive"
          mimeTypeFilter={[...HEALTH_VISION_MIMES]}
          rememberScope="health-fridge-receipt"
          onClose={() => setShowDrivePicker(false)}
          onFileSelected={(file: { uri: string; name: string }) => {
            setShowDrivePicker(false);
            addShot({ uri: file.uri, name: file.name || 'receipt.jpg' });
          }}
        />
      )}
    </HealthSectionScreen>
  );
}

/* ==================================================================== */
/* Receipt review                                                        */
/* ==================================================================== */

/**
 * One reviewable receipt line.
 *
 * Two independent decisions per row, because they really are independent: is
 * this going in the fridge at all, and should it carry the typical shelf life
 * for its category. A row whose category has no sensible default (anything the
 * reader could not place) gets no expiry control at all rather than a disabled
 * one that implies a date exists somewhere.
 */
function ReceiptRow({
  row,
  useTypical,
  onToggleSelected,
  onToggleExpiry,
}: {
  row: ReceiptDraftRow;
  useTypical: boolean;
  onToggleSelected: () => void;
  onToggleExpiry: () => void;
}) {
  const colors = useAppColors();

  return (
    <View
      style={[styles.itemRow, { borderTopColor: colors.borderColor }]}
      testID={`health-fridge-receipt-row-${row.key}`}
    >
      <Pressable
        onPress={onToggleSelected}
        accessibilityRole="checkbox"
        accessibilityLabel={row.name}
        accessibilityState={{ checked: row.selected }}
        testID={`health-fridge-receipt-tick-${row.key}`}
        hitSlop={8}
      >
        <Icon
          name={row.selected ? 'complete' : 'add'}
          size={18}
          color={row.selected ? colors.primary : colors.textSecondary}
        />
      </Pressable>

      <View style={styles.itemText}>
        <Typography variant="body" color={colors.textPrimary}>
          {row.name}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {[
            row.category,
            row.amountCents === null ? '' : formatMoney(row.amountCents, { decimals: 2 }),
          ]
            .filter((part) => part.length > 0)
            .join(' · ')}
        </Typography>
        {!row.looksLikeFood && (
          <Typography
            variant="caption2"
            color={colors.textSecondary}
            testID={`health-fridge-receipt-nonfood-${row.key}`}
          >
            This did not look like food, so it is not ticked.
          </Typography>
        )}
        {row.suggestedExpiryDate !== null && (
          <Pressable
            onPress={onToggleExpiry}
            accessibilityRole="switch"
            accessibilityLabel={`Use the typical shelf life for ${row.name}`}
            accessibilityState={{ checked: useTypical }}
            testID={`health-fridge-receipt-expiry-${row.key}`}
          >
            <Typography variant="caption2" color={useTypical ? colors.primary : colors.textSecondary}>
              {useTypical
                ? `Typically keeps ${row.suggestedExpiryDays} days — expiry ${row.suggestedExpiryDate}. Tap for no date.`
                : 'No expiry date. Tap to use the typical shelf life.'}
            </Typography>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ==================================================================== */
/* Meal ideas                                                            */
/* ==================================================================== */

function MealPlanCards({ plan }: { plan: HealthFridgeMealPlan }) {
  const colors = useAppColors();

  if (plan.meals.length === 0) {
    return (
      <Typography variant="body" color={colors.textSecondary} testID="health-fridge-meals-empty">
        {plan.notes ??
          'Nothing in your fridge adds up to a meal on its own right now. Add a few staples and try again.'}
      </Typography>
    );
  }

  return (
    <View style={styles.mealList} testID="health-fridge-meals-list">
      {plan.notes !== null && (
        <Typography variant="caption1" color={colors.textSecondary}>
          {plan.notes}
        </Typography>
      )}
      {plan.meals.map((meal, index) => (
        <MealCard key={`${meal.name}-${index}`} meal={meal} index={index} />
      ))}
      <Typography variant="caption2" color={colors.textSecondary} testID="health-fridge-meals-note">
        {`Built from ${plan.considered.length} ${plan.considered.length === 1 ? 'item' : 'items'} in your fridge. Calories and macros are estimates for one serving — weigh what you actually eat before logging it in Nutrition.`}
      </Typography>
    </View>
  );
}

function MealCard({ meal, index }: { meal: HealthFridgeMeal; index: number }) {
  const colors = useAppColors();
  const macros = [
    meal.calories === null ? null : `${Math.round(meal.calories)} kcal`,
    meal.protein_g === null ? null : `${Math.round(meal.protein_g)}g protein`,
    meal.carbs_g === null ? null : `${Math.round(meal.carbs_g)}g carbs`,
    meal.fat_g === null ? null : `${Math.round(meal.fat_g)}g fat`,
  ].filter((part): part is string => part !== null);

  return (
    <View
      style={[styles.mealCard, { borderColor: colors.borderColor }]}
      testID={`health-fridge-meal-${index}`}
    >
      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
        {meal.name}
      </Typography>
      {meal.description !== null && (
        <Typography variant="caption1" color={colors.textSecondary}>
          {meal.description}
        </Typography>
      )}

      {/* The whole point of the feature: which of the urgent food it uses up. */}
      {meal.uses_expiring.length > 0 && (
        <Typography
          variant="caption1"
          color={colors.primary}
          testID={`health-fridge-meal-urgent-${index}`}
        >
          {`Uses up ${meal.uses_expiring.join(', ')} — the food closest to its date.`}
        </Typography>
      )}

      <Typography variant="caption1" color={colors.textSecondary}>
        {`From your fridge: ${meal.ingredients_used.join(', ')}`}
      </Typography>
      {meal.missing_ingredients.length > 0 && (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`health-fridge-meal-missing-${index}`}
        >
          {`You would also need: ${meal.missing_ingredients.join(', ')}`}
        </Typography>
      )}

      {macros.length > 0 && (
        <Typography
          variant="caption2"
          color={colors.textSecondary}
          testID={`health-fridge-meal-macros-${index}`}
        >
          {/* "Estimated" is not decoration: these numbers were never weighed. */}
          {`Estimated per serving — ${macros.join(' · ')}`}
        </Typography>
      )}
      {meal.prep_minutes !== null && (
        <Typography variant="caption2" color={colors.textSecondary}>
          {`About ${meal.prep_minutes} minutes`}
        </Typography>
      )}

      {meal.instructions.map((step, stepIndex) => (
        <Typography key={`${stepIndex}-${step}`} variant="caption1" color={colors.textPrimary}>
          {`${stepIndex + 1}. ${step}`}
        </Typography>
      ))}
    </View>
  );
}

/**
 * Empty copy that says WHICH emptiness this is. "Nothing here" after a search
 * that matched nothing reads as data loss; naming the cause does not.
 */
export function emptyCopy(state: {
  total: number;
  filter: FridgeFilter;
  searching: boolean;
  cutoff: string;
}): string {
  if (state.total === 0) {
    return 'Your fridge is empty. Add what you have above and Symply Health will tell you what needs eating first.';
  }
  if (state.searching) return 'Nothing in your fridge matches that search.';
  if (state.filter === 'favorites') return 'You have not starred anything yet.';
  if (state.filter === 'expiring') {
    return `Nothing is dated on or before ${state.cutoff}. Items with no date are never counted here — switch to All to see them.`;
  }
  return 'Nothing to show.';
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  flexInput: {
    flex: 1,
  },
  notesInput: {
    minHeight: 66,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  lookupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
  },
  shotList: {
    gap: Spacing.xs,
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealList: {
    gap: Spacing.sm,
  },
  mealCard: {
    gap: 4,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
