import * as DocumentPicker from 'expo-document-picker';
// Expo SDK 54 made the top-level `readAsStringAsync` a throw-on-call
// deprecation stub. Use the `/legacy` subpath, as every other reader here does.
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { healthAiApi, type HealthNutritionLabelDraft, type HealthMealPhotoDraft } from '@api/healthAi';
import { CloudFilePicker } from '@components/cloud-storage';
import { ProcessingOverlay, ScanImportSources } from '@components/common';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import ImageCropPicker from '@services/image-picker-compat';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { isPickerPermissionError, presentPickerPermissionDeniedAlert } from '@utils/pickerPermissionAlert';

import {
  HealthScanCamera,
  HealthScanReview,
  HealthSectionScreen,
  type HealthScanCameraCapture,
} from '../components';
import { createFood } from '../healthFoodStorage';

/**
 * Scan — nutrition LABEL, meal PHOTO and WEIGH FOOD (scale), the donor's
 * three vision surfaces.
 *
 * Ports `NutritionLabelScannerView` (6 files / 3,938 lines), `FoodImageAnalysis`
 * (4 files / 2,406) and `ScaleFoodAnalysis` (3 / 1,137). UI_PARITY_AUDIT §6
 * listed all three as ❌; this is where all three land.
 *
 * ── THE CAMERA PATH DIFFERS BY MODE, ON PURPOSE, MATCHING THE DONOR ─────────
 *
 * The donor's own three screens do not all use the same camera. Read from
 * their source rather than assumed from screenshots:
 *
 *  - **Label and Scale** (`NutritionLabelScannerView`, `ScaleFoodCaptureView`)
 *    are a full-screen LIVE camera with a guided frame overlay, a manual
 *    shutter, and a flash toggle — ported here as `HealthScanCamera`, ONE
 *    shared primitive parameterised by frame shape/color/hints rather than
 *    two forked screens.
 *  - **Meal photo** (`FoodImageAnalysis/FoodCameraView.swift`) is the PLAIN
 *    SYSTEM camera (`UIImagePickerController`, no custom frame at all) plus a
 *    library picker — i.e. exactly what `handleCamera`/`handleGallery` below
 *    already did before this change. Meal mode's "Camera" tile is therefore
 *    left untouched; only Label and Scale route through `HealthScanCamera`.
 *
 * Scale mode calls the SAME `/health/ai/meal-photo` endpoint as meal mode —
 * the backend folds a kitchen scale in frame into the meal-photo read
 * (`scale_reading` on the response) rather than exposing a separate route, so
 * "Weigh food" here is meal-photo mode with different camera framing, not a
 * different API call.
 *
 * ── WHAT THIS SCREEN IS FOR ──────────────────────────────────────────────────
 *
 * It reads a picture and hands back a DRAFT. Nothing is saved until the person
 * has seen every figure and pressed Save — the same review-before-write contract
 * the Budget receipt scanner keeps, and the reason the backend's vision route
 * persists nothing at all. A label reading is saved to the food library
 * (`handleSaveFood`); a meal-photo/scale reading is reviewed and saved to the
 * diary through `HealthScanReview` (`../components/HealthScanReview.tsx`),
 * which files every kept row in one request via `/nutrition/entries/bulk`.
 *
 * ── DELIBERATE DIFFERENCES FROM THE DONOR ────────────────────────────────────
 *
 *  - **One scan, not two.** The donor reads the Nutrition Facts panel, then
 *    immediately asks the person to "Scan Product Name" from the front of the
 *    pack through a SECOND endpoint, because the panel rarely carries the brand.
 *    Here both frames go up in ONE request — attach the panel and the front, and
 *    the model reads them as one product. Two model calls to read one box of
 *    cereal is a cost and a wait the member pays for nothing.
 *  - **No on-device OCR fallback.** The donor falls back to `VNRecognizeTextRequest`
 *    plus a 760-line hand-written `NutritionLabelParser` when the backend is
 *    unreachable. That is an Apple-only pipeline with no cross-platform
 *    equivalent, and a second parser is a second set of numbers to disagree
 *    with. When the scan cannot run, this screen says so and offers manual
 *    entry, which is what the donor's own error state offers anyway.
 *  - **The per-100 basis is never computed here.** `src/api/healthFood.ts` states
 *    the rule — deriving a basis on the device is "the recompute-on-device
 *    trap". Save sends the portion and the macros FOR that portion; the Worker
 *    derives `base_*_per_100` exactly as it does for a typed food.
 *  - **`data_source` is shown, always.** The donor's provenance ladder is the
 *    one thing that lets a member tell a transcription from a guess, so every
 *    meal row carries its chip and estimated rows say "Estimated".
 *
 * HEIC is re-encoded to JPEG before upload — the backend refuses bytes it cannot
 * identify rather than forwarding them to a provider 400, and an iPhone hands
 * you HEIC by default. Same `toVisionSafeAttachment` step BudgetReceiptScanScreen
 * takes.
 */

type ScanMode = 'label' | 'meal' | 'scale';

interface Shot {
  uri: string;
  name: string;
}

const MAX_SHOTS = 4;

/** What the Worker's sniffer accepts. Anything else is re-encoded. */
const VISION_SAFE = /\.(jpe?g|png|webp)$/i;

/** The same set as MIME strings, for the file and Drive pickers. */
const VISION_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const MODE_COPY: Record<ScanMode, { title: string; hint: string; empty: string }> = {
  label: {
    title: 'NUTRITION LABEL',
    hint: 'Photograph the Nutrition Facts panel. Add a second shot of the front of the pack and the product name comes from it too.',
    empty: 'No nutrition information could be read from that. Try again in better light with the whole panel in frame, or add the food by hand.',
  },
  meal: {
    title: 'MEAL PHOTO',
    hint: 'Photograph the plate. If a kitchen scale is in frame its reading is used as the portion.',
    empty: 'No food could be identified in that photo. Try again in better light, or add the items by hand.',
  },
  scale: {
    title: 'WEIGH FOOD',
    hint: 'Photograph food on a kitchen scale with the display visible. The reading is used as the portion.',
    empty: 'No food could be identified on the scale. Try again with the scale display visible, or add the food by hand.',
  },
};

export function HealthScanScreen() {
  const colors = useAppColors();

  const [mode, setMode] = useState<ScanMode>('label');
  const [shots, setShots] = useState<Shot[]>([]);
  // The live guided camera (`HealthScanCamera`) — label/scale modes only.
  // Meal mode's "Camera" tile keeps using the plain system camera below
  // (`handleCamera`), matching the donor's own `FoodCameraView`.
  const [guidedCameraOpen, setGuidedCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [labelDraft, setLabelDraft] = useState<HealthNutritionLabelDraft | null>(null);
  const [mealDraft, setMealDraft] = useState<HealthMealPhotoDraft | null>(null);
  const [name, setName] = useState('');

  const reset = () => {
    setShots([]);
    setLabelDraft(null);
    setMealDraft(null);
    setName('');
    setMessage(null);
  };

  const switchMode = (next: ScanMode) => {
    if (next === mode) return;
    setMode(next);
    reset();
  };

  const addShot = (shot: Shot) =>
    setShots((prev) => (prev.length >= MAX_SHOTS ? prev : [...prev, shot]));

  const handleCamera = async () => {
    try {
      const image = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.8,
        mediaType: 'photo',
      });
      addShot({ uri: image.path, name: image.filename ?? 'scan.jpg' });
    } catch (error: unknown) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        setMessage('The camera could not be opened.');
      }
    }
  };

  /**
   * "Camera" tile — routes to the donor's ACTUAL per-mode camera rather than
   * one shared behaviour. Label/Scale get the live guided `HealthScanCamera`;
   * Meal keeps the plain system camera (`handleCamera`), because that is what
   * `FoodImageAnalysis/FoodCameraView.swift` itself uses — see the file header.
   */
  const handleCameraTile = () => {
    if (mode === 'meal') {
      void handleCamera();
      return;
    }
    setGuidedCameraOpen(true);
  };

  /** A shot taken through the live guided camera — added exactly like any other shot. */
  const handleGuidedCapture = (capture: HealthScanCameraCapture) => {
    addShot({ uri: capture.uri, name: capture.name });
    setGuidedCameraOpen(false);
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
        addShot({ uri: image.path, name: image.filename ?? 'scan.jpg' });
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
        type: [...VISION_MIMES],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      for (const asset of result.assets) {
        addShot({ uri: asset.uri, name: asset.name ?? 'scan.jpg' });
      }
    } catch {
      setMessage('The file picker could not be opened.');
    }
  };

  const handleScan = async () => {
    if (shots.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    setLabelDraft(null);
    setMealDraft(null);
    try {
      const images = await Promise.all(shots.map(toVisionSafeBase64));
      if (mode === 'label') {
        const { draft } = await healthAiApi.scanNutritionLabel(images);
        setLabelDraft(draft);
        setName(draft.product_name ?? '');
      } else {
        const { draft } = await healthAiApi.analyzeMealPhoto(images);
        // `foods` is the one field every render path indexes into. The Worker
        // always sends an array, but a truncated or older payload that omits it
        // used to be stored as-is and then crash the review card on the very
        // next render — a white screen instead of "nothing was identified".
        const foods = Array.isArray(draft.foods) ? draft.foods : [];
        setMealDraft({ ...draft, foods });
        // `mode` here is 'meal' OR 'scale' — both call this same branch, and
        // each has its own empty copy ("no scale display visible" reads
        // wrong on a plain plate photo and vice versa).
        if (foods.length === 0) setMessage(MODE_COPY[mode].empty);
      }
    } catch (error) {
      // The route already answers in plain words; anything it did not answer is
      // mapped by status. No provider or axios string reaches the member.
      setMessage(scanFailureMessage(error, mode));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Save the label draft as a food in the library.
   *
   * Sends the SERVING and the macros for that serving — never a per-100 basis
   * computed here. When the label printed only a per-100 column the serving IS
   * 100 g, which is the same statement without any arithmetic on the device.
   */
  const handleSaveFood = async () => {
    if (!labelDraft || saving) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setMessage('Give the food a name before saving it.');
      return;
    }
    // ONE derivation, not two: the portion and the macros must describe the
    // same column or the Worker infers a basis off a pair that never appeared
    // on the pack.
    //
    // The serving column is used only when the label carried BOTH a serving
    // mass and a per-serving energy figure. Plenty of packs print a serving
    // size and then only a per-100 table; those used to be refused with "no
    // calorie figure" and the member sent off to type it in by hand, even
    // though the draft held a complete per-100 basis.
    const servingG = labelDraft.serving_size_g;
    const usingServing = servingG != null && servingG > 0 && labelDraft.calories != null;
    const portion = usingServing ? servingG : 100;
    const usingPer100 = !usingServing;
    const calories = usingPer100 ? labelDraft.base_calories_per_100 : labelDraft.calories;
    if (calories == null) {
      setMessage('That scan has no calorie figure, so it cannot be saved. Add the food by hand.');
      return;
    }

    setSaving(true);
    const result = await createFood({
      name: trimmed,
      brand: labelDraft.brand ?? undefined,
      portion,
      unit: labelDraft.serving_size_unit ?? 'g',
      calories,
      protein: (usingPer100 ? labelDraft.base_proteins_per_100 : labelDraft.proteins) ?? 0,
      carbs: (usingPer100 ? labelDraft.base_carbs_per_100 : labelDraft.carbohydrates) ?? 0,
      fat: (usingPer100 ? labelDraft.base_fats_per_100 : labelDraft.fats) ?? 0,
      isFavorite: false,
      // The donor's own value, and the reason the enum has carried it since
      // 0120 with nothing ever writing it.
      sourceType: 'scanned',
    });
    setSaving(false);
    if (result.status === 'rejected') {
      // The draft stays put so the figures can be corrected or re-read.
      setMessage(result.message);
      return;
    }
    // ORDER MATTERS: `reset` clears the message card as well as the draft, so
    // setting the confirmation first wiped the whole screen with no word that
    // anything had been saved — including the "will sync when you are back
    // online" line, which is the only sign an offline save landed at all.
    reset();
    setMessage(result.message ?? `${trimmed} was added to your food library.`);
  };

  /**
   * The meal-photo review card (`HealthScanReview`) reports back only once
   * `logScannedFoodsToDiary` has actually landed — see the note on that
   * function for why a row with no calorie figure never reaches it. Same
   * order-matters reasoning as `handleSaveFood`: `reset` clears the message
   * card too, so the confirmation is set AFTER it.
   */
  const handleMealSaved = (confirmation: string) => {
    reset();
    setMessage(confirmation);
  };

  const copy = MODE_COPY[mode];

  return (
    <HealthSectionScreen title="Scan" testID="health-scan-screen">
      <ProcessingOverlay
        visible={busy}
        message={mode === 'label' ? 'Reading that label…' : 'Reading that photo…'}
        caption="Extracting the nutrition with AI"
        testID="health-scan-overlay"
      />

      {/* Mode — the donor ships these as two separate buttons on the Quick Add
          grid; one screen with two modes keeps the picker, the overlay and the
          review card from being written twice. */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-scan-mode-card"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WHAT ARE YOU SCANNING
        </Typography>
        <View style={styles.chipRow}>
          <ModeChip
            label="Nutrition label"
            icon="barcode"
            selected={mode === 'label'}
            onPress={() => switchMode('label')}
            testID="health-scan-mode-label"
          />
          <ModeChip
            label="Meal photo"
            icon="meals"
            selected={mode === 'meal'}
            onPress={() => switchMode('meal')}
            testID="health-scan-mode-meal"
          />
          <ModeChip
            label="Weigh food"
            icon="weight"
            selected={mode === 'scale'}
            onPress={() => switchMode('scale')}
            testID="health-scan-mode-scale"
          />
        </View>
        <Typography variant="caption1" color={colors.textSecondary} testID="health-scan-hint">
          {copy.hint}
        </Typography>
      </Card>

      {/* The shared Camera / Gallery / File / Drive row — never re-forked. */}
      <Card
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID="health-scan-sources-card"
      >
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {copy.title}
        </Typography>
        <ScanImportSources
          onCamera={handleCameraTile}
          onGallery={() => void handleGallery()}
          onFile={() => void handleFile()}
          onDrive={() => setShowDrivePicker(true)}
          disabled={busy || shots.length >= MAX_SHOTS}
          testIDPrefix="health-scan"
        />

        {shots.length > 0 && (
          <View style={styles.shotList} testID="health-scan-shots">
            {shots.map((shot, index) => (
              <View
                key={`${shot.uri}-${index}`}
                style={[styles.shotRow, { borderTopColor: colors.borderColor }]}
              >
                <Icon name="review-draft" size={16} color={colors.textSecondary} />
                <Typography variant="caption1" color={colors.textPrimary} style={styles.shotName}>
                  {shot.name}
                </Typography>
                <Pressable
                  onPress={() => setShots((prev) => prev.filter((_, i) => i !== index))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${shot.name}`}
                  testID={`health-scan-remove-${index}`}
                >
                  <Typography variant="caption1" weight="semibold" color={colors.error}>
                    Remove
                  </Typography>
                </Pressable>
              </View>
            ))}
            <Typography variant="caption2" color={colors.textSecondary}>
              {shots.length === MAX_SHOTS
                ? `That is the most this can read at once (${MAX_SHOTS}).`
                : `${shots.length} of ${MAX_SHOTS} images. All of them are read as ONE ${mode === 'label' ? 'product' : 'meal'}.`}
            </Typography>
          </View>
        )}

        <Pressable
          onPress={() => void handleScan()}
          disabled={shots.length === 0 || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: shots.length === 0 || busy }}
          accessibilityLabel={mode === 'label' ? 'Read this label' : 'Read this photo'}
          testID="health-scan-run"
          style={[
            styles.primaryButton,
            { backgroundColor: shots.length === 0 || busy ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {mode === 'label' ? 'Read this label' : 'Read this photo'}
          </Typography>
        </Pressable>
      </Card>

      {message !== null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-scan-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {labelDraft !== null && (
        <LabelReview
          draft={labelDraft}
          name={name}
          onChangeName={setName}
          onSave={() => void handleSaveFood()}
          onDiscard={reset}
          saving={saving}
        />
      )}

      {mealDraft !== null && mealDraft.foods.length > 0 && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-scan-meal-draft"
        >
          <HealthScanReview draft={mealDraft} onDiscard={reset} onSaved={handleMealSaved} />
        </Card>
      )}

      {showDrivePicker && (
        <CloudFilePicker
          visible={showDrivePicker}
          provider="google-drive"
          mimeTypeFilter={[...VISION_MIMES]}
          rememberScope="health-scan"
          onClose={() => setShowDrivePicker(false)}
          onFileSelected={(file: { uri: string; name: string }) => {
            setShowDrivePicker(false);
            addShot({ uri: file.uri, name: file.name || 'scan.jpg' });
          }}
        />
      )}

      {/* Live guided camera — label/scale modes only (see file header). Kept
          mounted with `visible={guidedCameraOpen}` rather than conditionally
          rendered so its own Modal owns show/hide transitions. */}
      <HealthScanCamera
        visible={guidedCameraOpen}
        onClose={() => setGuidedCameraOpen(false)}
        title={mode === 'scale' ? 'Weigh Food' : 'Scan Nutrition Label'}
        instruction={
          mode === 'scale'
            ? 'Position food on scale in frame'
            : 'Position the nutrition label within the frame'
        }
        hints={
          mode === 'scale'
            ? []
            : [
                { icon: 'sunny-outline', label: 'Good lighting' },
                { icon: 'scan-outline', label: 'Align label' },
                { icon: 'hand-left-outline', label: 'Hold steady' },
              ]
        }
        frameShape={mode === 'scale' ? 'dashed' : 'portrait'}
        accentColor={colors.primary}
        frameIcon={mode === 'scale' ? 'weight' : undefined}
        frameCaption={mode === 'scale' ? 'Make sure the scale display is visible' : undefined}
        onCapture={handleGuidedCapture}
      />
    </HealthSectionScreen>
  );
}

/* ==================================================================== */
/* Review cards                                                          */
/* ==================================================================== */

function LabelReview({
  draft,
  name,
  onChangeName,
  onSave,
  onDiscard,
  saving,
}: {
  draft: HealthNutritionLabelDraft;
  name: string;
  onChangeName: (value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const colors = useAppColors();

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID="health-scan-label-draft"
    >
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        WHAT THE LABEL SAYS
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary}>
        Nothing is saved yet. Check every figure — a scan is a reading, not a fact.
      </Typography>

      <Typography variant="caption1" color={colors.textSecondary}>
        Name
      </Typography>
      <TextInput
        value={name}
        onChangeText={onChangeName}
        placeholder="What is this food called?"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Food name"
        testID="health-scan-name-input"
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />

      <DraftRow label="Brand" value={draft.brand} testID="health-scan-brand" />
      <DraftRow label="Serving" value={draft.serving_size} testID="health-scan-serving" />
      {/* `== null` throughout: a field the payload OMITS means the same thing
          to a reader as one it sends as null, and `=== null` alone rendered the
          omitted case as the word "undefined" next to a unit. */}
      <DraftRow
        label="Calories per serving"
        value={draft.calories == null ? null : `${draft.calories} kcal`}
        testID="health-scan-calories"
      />
      <DraftRow
        label="Protein"
        value={draft.proteins == null ? null : `${draft.proteins} g`}
        testID="health-scan-protein"
      />
      <DraftRow
        label="Carbohydrate"
        value={draft.carbohydrates == null ? null : `${draft.carbohydrates} g`}
        testID="health-scan-carbs"
      />
      <DraftRow
        label="Fat"
        value={draft.fats == null ? null : `${draft.fats} g`}
        testID="health-scan-fat"
      />

      {/* Where the per-100 basis came from. "Copied off the label" and "we
          divided by the serving size" are not the same claim, and the app that
          re-portions from it should say which it has. */}
      <Typography variant="caption2" color={colors.textSecondary} testID="health-scan-basis-note">
        {draft.per_100_source === 'label'
          ? `Per 100 ${draft.serving_size_unit ?? 'g'} figures were copied from the label's own column.`
          : draft.per_100_source === 'derived'
            ? `Per 100 ${draft.serving_size_unit ?? 'g'} figures are worked out from the serving size, because the label printed no per-100 column.`
            : 'This label gave no serving size and no per-100 column, so the food cannot be re-portioned later.'}
      </Typography>

      {draft.confidence != null && draft.confidence < 0.7 && (
        <Typography variant="caption1" color={colors.error} testID="health-scan-low-confidence">
          Parts of that panel were hard to read. Check the figures before saving.
        </Typography>
      )}
      {draft.notes != null && (
        <Typography variant="caption2" color={colors.textSecondary} testID="health-scan-notes">
          {draft.notes}
        </Typography>
      )}

      <View style={styles.formActions}>
        <Pressable
          onPress={onSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel="Save to my food library"
          testID="health-scan-save"
          style={[
            styles.primaryButton,
            { backgroundColor: saving ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Save to my foods
          </Typography>
        </Pressable>
        <Pressable
          onPress={onDiscard}
          accessibilityRole="button"
          accessibilityLabel="Discard this scan"
          testID="health-scan-discard"
          style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Discard
          </Typography>
        </Pressable>
      </View>
    </Card>
  );
}

function DraftRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string | null;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.draftRow} testID={testID}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="body" color={value === null ? colors.textSecondary : colors.textPrimary}>
        {/* "Not on the label" is a fact; a dash reads as zero. */}
        {value ?? 'Not on the label'}
      </Typography>
    </View>
  );
}

function ModeChip({
  label,
  icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.backgroundMain,
          borderColor: colors.borderColor,
        },
      ]}
    >
      <Icon name={icon} size={14} color={selected ? colors.white : colors.textSecondary} />
      <Typography
        variant="caption1"
        weight="semibold"
        color={selected ? colors.white : colors.textSecondary}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

/* ==================================================================== */
/* Helpers                                                               */
/* ==================================================================== */

/**
 * Read a shot as base64, re-encoding anything the Worker's sniffer would refuse.
 *
 * The backend identifies the media type from the MAGIC BYTES and refuses what it
 * does not recognise, which is the right call — a HEIC forwarded to the provider
 * comes back as a 400 the member reads as "could not read that label". iOS hands
 * you HEIC by default, so the re-encode has to happen here.
 */
async function toVisionSafeBase64(shot: Shot): Promise<{ data: string; media_type: string }> {
  const alreadySafe = VISION_SAFE.test(shot.name) && !/\.(heic|heif)$/i.test(shot.name);
  if (alreadySafe) {
    const data = await FileSystem.readAsStringAsync(shot.uri, { encoding: 'base64' });
    return { data, media_type: mimeFor(shot.name) };
  }
  const rendered = await ImageManipulator.manipulate(shot.uri).renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const data = await FileSystem.readAsStringAsync(result.uri, { encoding: 'base64' });
  return { data, media_type: 'image/jpeg' };
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Map a failed scan to copy the member can act on.
 *
 * Reads the STATUS, never the server's message and never the axios error — the
 * repo-wide no-raw-error rule, and the same shape `resolveSoftTransferErrorMessage`
 * established.
 */
export function scanFailureMessage(error: unknown, mode: ScanMode): string {
  const status = (error as { response?: { status?: unknown } } | null | undefined)?.response
    ?.status;
  if (status === 403) {
    // Names the route to fixing it — More → AI access is the shared
    // `/ai-access` hub. "Not available" with no next step is where members
    // give up.
    return 'AI is not switched on for this account. Open More → AI access to turn it on, or add the food by hand.';
  }
  if (status === 415) {
    return 'That image could not be read. Take the photo again as a JPEG or PNG, or pick a different one.';
  }
  if (status === 422) {
    return MODE_COPY[mode].empty;
  }
  if (status === 429) {
    return 'That is a lot of scanning in one go. Try again in a few minutes.';
  }
  return 'The scanner could not be reached just now. Please try again in a moment.';
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  shotList: {
    gap: Spacing.xs,
  },
  shotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shotName: {
    flex: 1,
  },
  draftRow: {
    gap: 2,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
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
});
