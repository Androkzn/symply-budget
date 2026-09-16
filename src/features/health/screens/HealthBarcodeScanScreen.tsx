import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProcessingOverlay } from '@components/common';
import { Card, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthScanCamera, HEALTH_BARCODE_TYPES } from '../components/HealthScanCamera';
import { HealthSettingsShell } from '../components/HealthSettingsShell';
import {
  DEFAULT_MEAL_SLOT,
  formatMacro,
  importExternalFood,
  logExternalFoodToDiary,
  lookupFoodBarcode,
  type BarcodeLookupOutcome,
  type ExternalFoodItem,
} from '../healthFoodStorage';
import { MEAL_SLOT_LABELS, MEAL_SLOTS, type MealSlot } from '../healthNutritionStorage';

/**
 * Scan Barcode — the donor's `BarcodeScannerView` (SimpleHealth/Presentation/
 * Features/BarcodeScanner/BarcodeScannerView.swift), parity phase P5.
 *
 * The donor auto-detects continuously (`VNDetectBarcodesRequest` on every
 * frame) and hands the code to its PARENT, which dismisses the scanner and
 * does the lookup itself — "Parent view MUST dismiss the scanner in
 * onBarcodeScanned" per its own comment. This screen is that parent: the
 * live camera (`HealthScanCamera` in barcode mode) closes the instant a code
 * is read, and everything after that — the lookup, the found/not-found
 * copy, saving, logging — happens in this plain screen, not inside the
 * camera.
 *
 * `GET /health/foods/barcode` ALWAYS answers 200 (a code with zero digits is
 * the only 400): `food: null` with no `providerNotice` is "a well-formed
 * code the database does not recognise" — the member adds it by hand — and
 * is a completely different fact from `not_configured` / `rate_limited` /
 * `unavailable`, where the app could not even ask. The two must never share
 * one message (`lookupFoodBarcode` in `healthFoodStorage.ts` keeps them
 * apart; see `providerNoticeFor`).
 *
 * A found code is a `HealthExternalFood` hit, the exact shape `/foods/search`
 * returns for its `external` array — so saving and logging go through the
 * SAME `importExternalFood` / `logExternalFoodToDiary` calls the Foods tab
 * uses. No second "create a food from a barcode" write path exists.
 */
export function HealthBarcodeScanScreen() {
  const colors = useAppColors();
  const router = useRouter();

  const [cameraOpen, setCameraOpen] = useState(true);
  const [looking, setLooking] = useState(false);
  const [outcome, setOutcome] = useState<BarcodeLookupOutcome | null>(null);
  const [slot, setSlot] = useState<MealSlot>(DEFAULT_MEAL_SLOT);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }, [router]);

  const handleScanned = useCallback(
    (code: string) => {
      // The debounce inside `HealthScanCamera` stops the SAME code firing
      // twice; this guard stops a second, DIFFERENT code from interrupting a
      // lookup already in flight for the first one.
      if (looking) return;
      setCameraOpen(false);
      setOutcome(null);
      setMessage(null);
      setLooking(true);
      void lookupFoodBarcode(code).then((result) => {
        setOutcome(result);
        setLooking(false);
      });
    },
    [looking]
  );

  const handleRescan = useCallback(() => {
    setOutcome(null);
    setMessage(null);
    setCameraOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    const food = outcome?.food;
    if (!food || saving) return;
    setSaving(true);
    const result = await importExternalFood(food);
    setSaving(false);
    if (result.status === 'saved') {
      setMessage(
        result.created
          ? `Saved "${food.name}" to your foods.`
          : `"${food.name}" is already in your foods.`
      );
      return;
    }
    setMessage(result.message);
  }, [outcome, saving]);

  const handleLog = useCallback(async () => {
    const food = outcome?.food;
    if (!food || saving) return;
    setSaving(true);
    const result = await logExternalFoodToDiary(food, { mealSlot: slot });
    setSaving(false);
    if (result.status !== 'saved') {
      setMessage(result.message);
      return;
    }
    const logged = result.logged;
    setMessage(
      logged
        ? `Added ${formatMacro(logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}, and saved "${food.name}" to your foods.`
        : `Added "${food.name}" to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
    );
  }, [outcome, saving, slot]);

  return (
    <HealthSettingsShell title="Scan Barcode" testID="health-barcode-scan-screen">
      <ProcessingOverlay
        visible={looking}
        message="Looking up that barcode…"
        caption="Checking the food database"
        testID="health-barcode-scan-overlay"
      />

      {outcome === null && !looking && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-barcode-scan-idle"
        >
          <Typography variant="footnote" color={colors.textSecondary}>
            Point the camera at a UPC or EAN barcode to look up a packaged
            food.
          </Typography>
          <Pressable
            onPress={() => setCameraOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Scan a barcode"
            testID="health-barcode-scan-open"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Scan a barcode
            </Typography>
          </Pressable>
        </Card>
      )}

      {outcome !== null && outcome.food !== null && (
        <FoundFoodCard
          food={outcome.food}
          slot={slot}
          onChangeSlot={setSlot}
          onSave={() => void handleSave()}
          onLog={() => void handleLog()}
          onRescan={handleRescan}
          saving={saving}
        />
      )}

      {outcome !== null && outcome.food === null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-barcode-scan-notfound"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {outcome.providerNotice !== null ? 'COULD NOT LOOK THAT UP' : 'NOT IN THE DATABASE'}
          </Typography>
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            accessibilityLabel={outcome.providerNotice ?? undefined}
            testID="health-barcode-scan-notice"
          >
            {outcome.providerNotice ??
              'That barcode is not in the food database yet. Add it by hand from the Foods tab.'}
          </Typography>
          <Pressable
            onPress={handleRescan}
            accessibilityRole="button"
            accessibilityLabel="Scan another barcode"
            testID="health-barcode-scan-again"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.white}>
              Scan another barcode
            </Typography>
          </Pressable>
        </Card>
      )}

      {message !== null && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-barcode-scan-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      <HealthScanCamera
        visible={cameraOpen}
        onClose={outcome !== null ? () => setCameraOpen(false) : goBack}
        title="Scan Barcode"
        instruction="Point camera at barcode"
        hints={[
          { icon: 'barcode-outline', label: 'UPC/EAN' },
          { icon: 'sunny-outline', label: 'Good lighting' },
          { icon: 'hand-left-outline', label: 'Hold steady' },
        ]}
        frameShape="landscape"
        accentColor={colors.primary}
        barcodeTypes={HEALTH_BARCODE_TYPES}
        onBarcodeScanned={handleScanned}
        processing={looking}
        processingMessage="Looking up that barcode…"
      />
    </HealthSettingsShell>
  );
}

function FoundFoodCard({
  food,
  slot,
  onChangeSlot,
  onSave,
  onLog,
  onRescan,
  saving,
}: {
  food: ExternalFoodItem;
  slot: MealSlot;
  onChangeSlot: (slot: MealSlot) => void;
  onSave: () => void;
  onLog: () => void;
  onRescan: () => void;
  saving: boolean;
}) {
  const colors = useAppColors();
  const serving = food.servings.find((s) => s.id === food.servingId) ?? {
    description: food.servingDescription ?? `${formatMacro(food.portion)} ${food.unit}`,
    macros: food.serving,
  };

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID="health-barcode-scan-found"
    >
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        FOUND
      </Typography>
      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
        {food.brand ? `${food.name} · ${food.brand}` : food.name}
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary} testID="health-barcode-scan-macros">
        {serving.description} · {formatMacro(serving.macros.calories)} kcal ·{' '}
        {formatMacro(serving.macros.protein)}P / {formatMacro(serving.macros.carbs)}C /{' '}
        {formatMacro(serving.macros.fat)}F
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary}>
        {formatMacro(food.per100.calories)} kcal / 100 {food.unit === 'ml' ? 'ml' : 'g'}
      </Typography>

      <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
        {MEAL_SLOTS.map((option) => {
          const active = option === slot;
          return (
            <Pressable
              key={option}
              onPress={() => onChangeSlot(option)}
              accessibilityRole="button"
              accessibilityLabel={`Log to ${MEAL_SLOT_LABELS[option]}`}
              accessibilityState={{ selected: active }}
              testID={`health-barcode-scan-slot-${option}`}
              style={[styles.segment, active && { backgroundColor: colors.primary }]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {MEAL_SLOT_LABELS[option]}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.formActions}>
        <Pressable
          onPress={onLog}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel={`Log ${food.name} to ${MEAL_SLOT_LABELS[slot]}`}
          testID="health-barcode-scan-log"
          style={[
            styles.primaryButton,
            styles.formActionButton,
            { backgroundColor: saving ? colors.borderColor : colors.primary },
          ]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Log to {MEAL_SLOT_LABELS[slot]}
          </Typography>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving }}
          accessibilityLabel={`Save ${food.name} to your foods`}
          testID="health-barcode-scan-save"
          style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Save only
          </Typography>
        </Pressable>
      </View>

      <Pressable
        onPress={onRescan}
        accessibilityRole="button"
        accessibilityLabel="Scan another barcode"
        testID="health-barcode-scan-rescan"
      >
        <Typography variant="caption1" weight="semibold" color={colors.primary}>
          Scan another barcode
        </Typography>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  primaryButton: {
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
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  formActionButton: {
    flex: 1,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HealthBarcodeScanScreen;
