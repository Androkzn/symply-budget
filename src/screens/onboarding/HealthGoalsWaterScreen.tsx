import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  OnboardingChoiceChips,
  OnboardingStepScreen,
  OnboardingSuggestionBanner,
} from '@components/onboarding';
import { Icon, InfoButton, NumberWheelPickerSheet, Typography, type InfoSource } from '@components/ui';
import { WATER_ML_PER_KG } from '@features/health/healthGoalsStorage';
import { CUP_ML } from '@features/health/healthLocalStorage';
import {
  formatVolume,
  loadWaterPrefs,
  parseVolume,
  saveWaterUnit,
  setWaterGoalMl,
  toUnitInput,
  unitLabel,
  type WaterUnit,
} from '@features/health/healthWaterStorage';
import { ACTIVITY_LABELS } from '@features/health/healthWeightAnalytics';
import { useSuggestedGoals } from '@features/health/useHealthGoalsSuggestion';
import type { OnboardingStackParamList } from '@navigation/types';
import { CornerRadius, scaledFont, Sheet, Spacing, useAppColors } from '@theme';

const ACTIVITY_LEVELS_IN_ORDER = Object.keys(ACTIVITY_LABELS) as (keyof typeof ACTIVITY_LABELS)[];

const WATER_SUGGESTION_SOURCES: InfoSource[] = [
  {
    label: 'EFSA NDA Panel (2010) — Scientific Opinion on Dietary Reference Values for water, EFSA Journal',
    url: 'https://doi.org/10.2903/j.efsa.2010.1459',
  },
];

type NavigationProp = NativeStackNavigationProp<OnboardingStackParamList, 'HealthGoalsWater'>;
type RouteProps = RouteProp<OnboardingStackParamList, 'HealthGoalsWater'>;

const UNIT_OPTIONS: { key: WaterUnit; label: string }[] = [
  { key: 'ml', label: 'mL' },
  { key: 'L', label: 'L' },
  { key: 'cups', label: 'Cups' },
  { key: 'oz', label: 'fl oz' },
];

/**
 * Wheel range + step + starting point PER UNIT, and — the "suggested
 * bubbles" — round, unit-native preset amounts. Deliberately NOT one fixed
 * set of millilitre presets re-labelled per unit (`WATER_GOAL_PRESETS_ML`,
 * the dedicated Water tab's own goal editor, does exactly that): "3,000 ml"
 * converts to a clean "3 L" but an ugly "12.5 cups" or "101 fl oz" — a member
 * who picked cups or ounces should see round numbers in THEIR unit, not a
 * conversion of somebody else's.
 */
const WATER_WHEEL_CONFIG: Record<WaterUnit, { min: number; max: number; step: number; defaultValue: number }> = {
  ml: { min: 250, max: 5000, step: 50, defaultValue: 2000 },
  L: { min: 0.5, max: 5, step: 0.1, defaultValue: 2 },
  cups: { min: 1, max: 20, step: 1, defaultValue: 8 },
  oz: { min: 8, max: 170, step: 2, defaultValue: 68 },
};

const WATER_UNIT_PRESETS: Record<WaterUnit, number[]> = {
  ml: [1500, 2000, 2500, 3000],
  L: [1.5, 2, 2.5, 3],
  cups: [6, 8, 10, 12],
  oz: [50, 68, 84, 100],
};

/**
 * Digits and at most one decimal point — `parseVolume` only ever strips
 * `[^0-9.]`, so a comma decimal (or a second point from a fast typist) would
 * otherwise reach it and parse as nonsense rather than the number a member
 * actually typed.
 */
function sanitizeVolumeInput(raw: string): string {
  const digitsAndDot = raw.replace(/[^0-9.]/g, '');
  const firstDot = digitsAndDot.indexOf('.');
  if (firstDot === -1) return digitsAndDot;
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * Symply Health goals mini-flow, step 5 of 7 — the daily water target.
 * Writes through `setWaterGoalMl` + `saveWaterUnit`, the SAME two functions
 * the dedicated Water tab's own goal editor and ml/oz toggle use, so a target
 * (and a unit) set here shows up there immediately and vice versa.
 *
 * FOUR UNITS (mL / L / cups / fl oz), switchable both on the screen and
 * inside the wheel sheet itself (`NumberWheelPickerSheet`'s `accessory`
 * slot) — switching converts whatever is already typed rather than
 * discarding it. The amount is ALWAYS stored as millilitres
 * (`daily_water_ml`); only the display unit is a member choice, and that
 * choice itself now syncs across devices (0140) rather than staying
 * device-local the way the dedicated tab's older ml/oz toggle did.
 *
 * A "Suggested for you" banner appears once `useSuggestedGoals()` has an
 * answer (weight from the previous step, activity level from "About you") —
 * the same `WATER_ML_PER_KG` formula the in-app Goals screen's suggestion
 * already uses, expressed here in whichever unit is currently selected.
 */
export function HealthGoalsWaterScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const suggestion = useSuggestedGoals();

  const [unit, setUnit] = useState<WaterUnit>('ml');
  const [amount, setAmount] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    // Nothing is typed yet at this point in a fresh onboarding session, so
    // there is nothing to convert — a straight `setUnit` is correct here,
    // unlike `handleUnitChange` below, which has to preserve a typed amount.
    void loadWaterPrefs().then((prefs) => setUnit(prefs.unit));
  }, []);

  const ml = parseVolume(amount, unit);
  const cfg = WATER_WHEEL_CONFIG[unit];
  const numericValue = amount.length > 0 ? Number(amount.replace(',', '.')) : NaN;
  const hasValue = Number.isFinite(numericValue);
  const decimalStep = !Number.isInteger(cfg.step);

  const advance = () => navigation.navigate('EssentialPermissions', route.params);

  const handleUnitChange = (next: WaterUnit) => {
    if (next === unit) return;
    setAmount(ml > 0 ? toUnitInput(ml, next) : '');
    setUnit(next);
  };

  const applySuggestion = () => {
    if (suggestion === null) return;
    setAmount(toUnitInput(suggestion.waterCups * CUP_ML, unit));
  };

  const openPicker = () => {
    if (manualMode) return;
    setPickerVisible(true);
  };

  const handleWellPress = () => {
    if (manualMode) {
      inputRef.current?.focus();
    } else {
      setPickerVisible(true);
    }
  };

  const handleManualEntry = () => {
    setPickerVisible(false);
    setManualMode(true);
    // Wait out the sheet's close animation so the keyboard isn't fighting the
    // sheet's slide-down for the screen.
    setTimeout(() => inputRef.current?.focus(), Sheet.dismissAnimDurationMs);
  };

  const handleContinue = async () => {
    if (ml <= 0) {
      advance();
      return;
    }

    setSaving(true);
    try {
      // Saved together — the unit is only worth remembering alongside a real
      // target, same "skip means no write" contract every other field on
      // this screen already has.
      await Promise.all([setWaterGoalMl(ml), saveWaterUnit(unit)]);
    } catch {
      // Both writes already queue for offline retry.
    } finally {
      setSaving(false);
      advance();
    }
  };

  // A function, not a single element reused twice: the sheet stays MOUNTED
  // behind its own `BottomSheet` overlay while open, so a shared element
  // would put two identically-`testID`'d chip rows on screen at once — one
  // behind the sheet, one inside it — which Maestro cannot address
  // unambiguously. Distinct prefixes keep both reachable.
  const renderUnitSwitcher = (testIDPrefix: string) => (
    <OnboardingChoiceChips
      options={UNIT_OPTIONS}
      selected={unit}
      onSelect={(key) => handleUnitChange(key as WaterUnit)}
      testIDPrefix={testIDPrefix}
      accessibilityLabelPrefix="Water unit"
      variant="segmented"
    />
  );

  return (
    <OnboardingStepScreen
      testID="onboarding-health-goals-water-screen"
      title="Water"
      subtitle="A daily hydration target, in whichever unit you think in. Optional, like everything else here."
      currentStep={5}
      totalSteps={8}
      stepLabel="Water"
      icon="water-outline"
      onBack={() => navigation.goBack()}
      onContinue={() => void handleContinue()}
      continueBusy={saving}
    >
      {suggestion && (
        <OnboardingSuggestionBanner
          description={`${formatVolume(suggestion.waterCups * CUP_ML, unit)} a day, based on your weight and activity level.`}
          onApply={applySuggestion}
          testID="onboarding-health-goals-water-suggestion"
          info={
            <InfoButton
              title="Suggested for you"
              sources={WATER_SUGGESTION_SOURCES}
              testID="onboarding-health-goals-water-suggestion-info"
            >
              <WaterSuggestionInfoBody />
            </InfoButton>
          }
        />
      )}

      {renderUnitSwitcher('onboarding-health-goals-water-unit')}

      <Typography variant="caption1" color={colors.textSecondary}>
        Daily water ({unitLabel(unit)})
      </Typography>
      <Pressable
        onPress={handleWellPress}
        style={[styles.well, { borderColor: colors.borderColor, backgroundColor: colors.backgroundMain }]}
      >
        <TextInput
          ref={inputRef}
          value={amount}
          onChangeText={(text) => setAmount(sanitizeVolumeInput(text))}
          onFocus={openPicker}
          showSoftInputOnFocus={manualMode}
          caretHidden={!manualMode}
          placeholder="Tap to choose"
          placeholderTextColor={colors.textSecondary}
          keyboardType={decimalStep ? 'decimal-pad' : 'number-pad'}
          autoCorrect={false}
          pointerEvents={manualMode ? 'auto' : 'none'}
          accessibilityLabel={`Daily water in ${unitLabel(unit)}`}
          testID="onboarding-health-goals-water-input"
          style={[styles.input, { color: colors.textPrimary }]}
        />
        {hasValue && (
          <Typography variant="subheadline" color={colors.textSecondary}>
            {unitLabel(unit)}
          </Typography>
        )}
        {!manualMode && <Icon name="chevron-down" size={16} color={colors.textSecondary} />}
      </Pressable>

      <OnboardingChoiceChips
        options={WATER_UNIT_PRESETS[unit].map((value) => ({
          key: String(value),
          label: `${value} ${unitLabel(unit)}`,
        }))}
        selected={null}
        onSelect={(key) => setAmount(key)}
        testIDPrefix="onboarding-health-goals-water-preset"
      />

      {unit !== 'ml' && ml > 0 ? (
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID="onboarding-health-goals-water-ml"
        >
          = {formatVolume(ml, 'ml')} a day.
        </Typography>
      ) : null}

      <NumberWheelPickerSheet
        visible={pickerVisible}
        title="Daily water"
        value={hasValue ? numericValue : cfg.defaultValue}
        min={cfg.min}
        max={cfg.max}
        step={cfg.step}
        unitLabel={unitLabel(unit)}
        onConfirm={(picked) => setAmount(String(picked))}
        onClose={() => setPickerVisible(false)}
        onManualEntry={handleManualEntry}
        accessory={renderUnitSwitcher('onboarding-health-goals-water-unit-sheet')}
        testID="onboarding-health-goals-water-input-picker"
      />
    </OnboardingStepScreen>
  );
}

/**
 * Rich body for the "Suggested for you" `InfoButton` on this screen's
 * banner — the formula, then `WATER_ML_PER_KG` (imported from
 * `healthGoalsStorage`, not restated) as a per-activity-level reference
 * table, in the SAME unit the member is currently viewing amounts in.
 */
function WaterSuggestionInfoBody() {
  const colors = useAppColors();
  return (
    <View style={styles.info}>
      <Typography variant="caption2" color={colors.textSecondary}>
        Daily water = your weight (kg) × a factor for your activity level, rounded to the nearest
        100 ml. The factor sits around EFSA's general adult guideline of roughly 30–35 ml per kg
        of body weight a day, raised further for the two most active levels.
      </Typography>

      <View style={[styles.table, { borderColor: colors.borderColor }]}>
        {ACTIVITY_LEVELS_IN_ORDER.map((level, index) => (
          <View
            key={level}
            style={[
              styles.tableRow,
              index < ACTIVITY_LEVELS_IN_ORDER.length - 1 && [
                styles.tableRowDivider,
                { borderColor: colors.borderColor },
              ],
            ]}
          >
            <Typography variant="caption1" color={colors.textPrimary}>
              {ACTIVITY_LABELS[level]}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {WATER_ML_PER_KG[level]} ml/kg
            </Typography>
          </View>
        ))}
      </View>

      <Typography variant="caption2" color={colors.textSecondary}>
        A general estimate, not a measurement of you — hot weather, exercise and
        pregnancy/breastfeeding all raise real needs above it, and thirst is a fine guide day to
        day.
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    ...scaledFont('body'),
  },
  info: { gap: Spacing.md },
  table: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  tableRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
