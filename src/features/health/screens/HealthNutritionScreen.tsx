import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  HealthCalorieRingCard,
  HealthCopyMealSheet,
  HealthCopyToSheet,
  HealthMacroBreakdown,
  HealthMealDetail,
  HealthMealSelectionBar,
  HealthQuickAdd,
  HealthSectionScreen,
  HealthStatTiles,
  HealthTodayChallengesCard,
  type CopyRequest,
  type MealEntryPatch,
} from '../components';
import {
  loadFoods,
  loadFoodSuggestions,
  logFoodToDiary,
  type FoodItem,
  type FoodSuggestion,
} from '../healthFoodStorage';
import {
  adjustWater,
  DEFAULT_WATER_TARGET,
  loadWaterToday,
  todayDateKey,
  type WaterDay,
} from '../healthLocalStorage';
import {
  addMealEntry,
  copiedMessage,
  copyMealEntriesTo,
  copyMealsFromDay,
  deleteMealEntries,
  deleteMealEntry,
  DEFAULT_NUTRITION_GOALS,
  formatDayKey,
  groupBySlot,
  loadMealsForDate,
  loadNutritionGoals,
  MEAL_SLOT_ICONS,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  NO_BASIS_MESSAGE,
  parseCaloriesInput,
  parseMacroInput,
  reportionMealEntry,
  sanitizeAmountInput,
  saveNutritionGoals,
  shiftDateKey,
  sumNutrition,
  updateMealEntry,
  type MealEntry,
  type MealSlot,
  type NutritionGoals,
} from '../healthNutritionStorage';
import { useHealthKitSyncHydration } from '../useHealthKitSyncHydration';

/**
 * Nutrition tab — the donor's "Meals" surface at parity.
 *
 * The donor's `NutritionView` is its largest screen; what it actually gave the
 * user, and what this rebuilds, is:
 *
 *  - a day view with a calorie ring against the goal, what is left (or over),
 *    macro bars and a per-meal-slot subtotal;
 *  - a macro split of the day;
 *  - meal detail: open a slot, edit an item, move it to another meal, delete it;
 *  - quick add from the food library — suggestions, favourites, recents — plus a
 *    bare calories-only entry;
 *  - a day stepper with a way back to today, and honest empty states.
 *
 * TWO RULES SHAPE THE CODE MORE THAN ANYTHING ELSE:
 *
 * 1. Nutrition is never computed on the device. Diary rows, goals and library
 *    servings all arrive derived; the only arithmetic here is summing rows the
 *    server already computed (`sumNutrition`) and the presentation-level percent
 *    split in `HealthMacroBreakdown`. Portion-scaled logging goes through
 *    `/custom-foods/:id/use`, which answers with the serving to file.
 *
 * 2. An edit is an UPDATE, in place. This screen used to add the replacement and
 *    then delete the original, because the client had no update method — which
 *    minted a new row id and reset `loggedAt`, so an edited item jumped to the
 *    end of its slot. `PUT /health/nutrition/entries/:id` keeps the row's
 *    identity and its position in the day; a MOVE between slots is the same
 *    call with a different `meal_type`.
 *
 * 3. A PORTION change is the server's arithmetic, never this screen's. Since
 *    0124 a diary row logged from the library carries `food_id` and the
 *    `base_*_per_100` basis, so `POST /nutrition/entries/:id/portion` can
 *    re-derive its macros. Rows without a basis (hand-typed, or logged before
 *    0124) do not get the control at all rather than getting one that 400s.
 *
 * 4. A COPY is one request, and a BATCH DELETE tells the truth. `copy-day` and
 *    `entries/bulk` had been deployed to staging and production with no client
 *    at all, so "same dinner as yesterday" cost N manual entries. Both are now
 *    called (`HealthCopyMealSheet`, `HealthCopyToSheet`, `HealthMealSelectionBar`).
 *    There is no bulk
 *    DELETE route, so that one is a client-side batch — it attempts every id
 *    rather than stopping at the first failure, and reports the split
 *    ("Removed 4 of 6") instead of a generic error, which is exactly where the
 *    donor's `deleteEntries` left the screen and the database disagreeing.
 */

const WRITE_FAILED_MESSAGE = 'That did not save. Check your connection and try again.';

export function HealthNutritionScreen() {
  const colors = useAppColors();
  const router = useRouter();

  const [date, setDate] = useState(todayDateKey());
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [goals, setGoals] = useState<NutritionGoals>(DEFAULT_NUTRITION_GOALS);
  const [waterDay, setWaterDay] = useState<WaterDay | null>(null);
  const [loading, setLoading] = useState(true);

  const [slot, setSlot] = useState<MealSlot>('breakfast');
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [foodsLoading, setFoodsLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<FoodSuggestion[]>([]);
  const [suggestionsUnavailable, setSuggestionsUnavailable] = useState(false);

  const [expandedOverrides, setExpandedOverrides] = useState<Partial<Record<MealSlot, boolean>>>({});
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [busyFoodId, setBusyFoodId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  /** The Add Food card: open by default on an empty day, shut once it is not. */
  const [addFoodOverride, setAddFoodOverride] = useState<boolean | null>(null);
  const [addMode, setAddMode] = useState<'quick' | 'manual'>('quick');
  /** PULL — bring another meal into the one on screen (Add Food card). */
  const [copyMealSheetOpen, setCopyMealSheetOpen] = useState(false);
  /** PUSH — send a populated meal-group's contents elsewhere. */
  const [copyToSlot, setCopyToSlot] = useState<MealSlot | null>(null);
  /** Multi-select is scoped to ONE slot at a time, as in the donor. */
  const [selectingSlot, setSelectingSlot] = useState<MealSlot | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  const isToday = date === todayDateKey();

  const hydrate = useCallback(async (forDate: string) => {
    const [dayEntries, storedGoals, water] = await Promise.all([
      loadMealsForDate(forDate),
      loadNutritionGoals(),
      loadWaterToday(),
    ]);
    setEntries(dayEntries);
    setGoals(storedGoals);
    setWaterDay(water);
    setLoading(false);
  }, []);

  // Re-hydrate on every focus (not just mount/date change) so a HealthKit
  // background sync completed on another tab shows up as soon as the user
  // comes back to Nutrition, matching BudgetDashboardView's pattern.
  useFocusEffect(
    useCallback(() => {
      void hydrate(date);
    }, [date, hydrate]),
  );

  // Re-hydrate when a HealthKit sync lands while this tab is focused.
  const hydrateForSync = useCallback(() => {
    void hydrate(date);
  }, [date, hydrate]);
  useHealthKitSyncHydration(hydrateForSync);

  // The library is day-independent, so it loads once and survives day stepping.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const library = await loadFoods();
      if (cancelled) return;
      setFoods(library);
      setFoodsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Suggestions are a function of the CURRENT time bucket and the slot being
  // added to, so they are re-asked whenever the slot changes and never cached.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const answer = await loadFoodSuggestions(slot);
      if (cancelled) return;
      setSuggestions(answer?.suggestions ?? []);
      setSuggestionsUnavailable(answer === null);
    })();
    return () => {
      cancelled = true;
    };
  }, [slot]);

  const totals = useMemo(() => sumNutrition(entries), [entries]);
  const grouped = useMemo(() => groupBySlot(entries), [entries]);

  const favorites = useMemo(() => foods.filter((food) => food.isFavorite), [foods]);
  const recents = useMemo(
    () =>
      foods
        // "Never used" is `lastUsedAt: null`, and a row that arrived without the
        // key at all has not been used either — so the guard asks for a
        // timestamp rather than for "not null", which would let `undefined`
        // through and offer a never-used food as a recent one.
        .filter((item): item is FoodItem & { lastUsedAt: string } =>
          typeof item.lastUsedAt === 'string'
        )
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
        .slice(0, 8),
    [foods]
  );

  const leftToGoal = goals.calories - totals.calories;
  const remaining = Math.max(0, leftToGoal);
  const overBy = Math.max(0, -leftToGoal);

  const parsedCalories = parseCaloriesInput(calories);
  const canAdd = parsedCalories !== null && parsedCalories > 0;

  const refreshDay = useCallback(async (forDate: string) => {
    setEntries(await loadMealsForDate(forDate));
  }, []);

  const handleAdd = async () => {
    const kcal = parseCaloriesInput(calories);
    if (kcal === null || kcal <= 0) return;
    const p = parseMacroInput(protein);
    const c = parseMacroInput(carbs);
    const f = parseMacroInput(fat);
    if (p === null || c === null || f === null) {
      Alert.alert('Check the macros', 'Protein, carbs and fat must be numbers in grams.');
      return;
    }
    setEntries(
      await addMealEntry({ name, slot, calories: kcal, protein: p, carbs: c, fat: f, date })
    );
    setName('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
  };

  const handleDelete = async (id: string) => {
    setEntries(await deleteMealEntry(id, date));
  };

  /**
   * Patch a row in place. Replaces the add-then-delete dance this screen used
   * while the client had no update method: two round trips, a new row id, and a
   * reset `loggedAt` that moved the item to the end of its slot.
   */
  const patchEntry = useCallback(
    async (entry: MealEntry, next: Partial<MealEntryPatch> & { slot?: MealSlot }) => {
      setBusyEntryId(entry.id);
      setBanner(null);
      try {
        setEntries(await updateMealEntry(entry.id, next, date));
      } catch {
        setBanner(WRITE_FAILED_MESSAGE);
        await refreshDay(date);
      } finally {
        setBusyEntryId(null);
      }
    },
    [date, refreshDay]
  );

  const handleSaveEntry = useCallback(
    (entry: MealEntry, patch: MealEntryPatch) => {
      void patchEntry(entry, patch);
    },
    [patchEntry]
  );

  const handleMoveEntry = useCallback(
    (entry: MealEntry, target: MealSlot) => {
      // A move is the same update with a different slot — nothing else changes,
      // so nothing else is sent.
      void patchEntry(entry, { slot: target });
    },
    [patchEntry]
  );

  /**
   * Change a logged row's PORTION and let the server re-derive its macros.
   *
   * `no-basis` is a real answer, not a failure: the row was typed in and has no
   * per-100 basis to rescale from, so the user is told to edit the numbers
   * instead. Nothing here multiplies a macro.
   */
  const handleReportionEntry = useCallback(
    (entry: MealEntry, portion: number) => {
      void (async () => {
        setBusyEntryId(entry.id);
        setBanner(null);
        try {
          const result = await reportionMealEntry(entry.id, portion, date);
          setEntries(result.entries);
          if (result.status === 'no-basis') setBanner(NO_BASIS_MESSAGE);
          else if (result.status === 'failed') setBanner(WRITE_FAILED_MESSAGE);
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
          await refreshDay(date);
        } finally {
          setBusyEntryId(null);
        }
      })();
    },
    [date, refreshDay]
  );

  const handleDeleteEntry = useCallback(
    (entry: MealEntry) => {
      void handleDelete(entry.id);
    },
    // `handleDelete` closes over `date`, which is the only thing it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date]
  );

  /* ---------------- copy + multi-select (the diary's batch verbs) --------- */

  const exitSelect = useCallback(() => {
    setSelectingSlot(null);
    setSelectedIds([]);
  }, []);

  // Stepping to another day drops any open sheet or selection. All are scoped
  // to the day on screen, and a selection carried across a day change would
  // offer to delete rows the user can no longer see.
  useEffect(() => {
    setCopyMealSheetOpen(false);
    setCopyToSlot(null);
    exitSelect();
  }, [date, exitSelect]);

  const openCopyMealSheet = useCallback(() => {
    exitSelect();
    setBanner(null);
    setCopyMealSheetOpen(true);
  }, [exitSelect]);

  const openCopyToSheet = useCallback(
    (target: MealSlot) => {
      exitSelect();
      setBanner(null);
      setCopyToSlot((current) => (current === target ? null : target));
    },
    [exitSelect]
  );

  const startSelecting = useCallback(
    (target: MealSlot) => {
      setCopyMealSheetOpen(false);
      setCopyToSlot(null);
      setBanner(null);
      setSelectedIds([]);
      setSelectingSlot((current) => (current === target ? null : target));
      // The donor auto-expands the slot it starts selecting in — tick boxes in a
      // collapsed card would be unreachable.
      setExpandedOverrides((current) => ({ ...current, [target]: true }));
    },
    []
  );

  const toggleSelected = useCallback((entry: MealEntry) => {
    setSelectedIds((current) =>
      current.includes(entry.id)
        ? current.filter((id) => id !== entry.id)
        : [...current, entry.id]
    );
  }, []);

  /**
   * Copy one meal onto another — pulled in from elsewhere, or pushed out to
   * elsewhere. Both directions resolve to the same `/copy-day` request; only
   * which side (`toDate`/`toSlot` vs `fromDate`/`fromSlot`) the sheet held
   * fixed differs. One request either way.
   */
  const handleCopyFrom = useCallback(
    (request: CopyRequest) => {
      void (async () => {
        setBatchBusy(true);
        setBanner(null);
        try {
          const result = await copyMealsFromDay(
            {
              fromDate: request.fromDate,
              toDate: request.toDate,
              ...(request.fromSlot ? { fromSlot: request.fromSlot } : {}),
              ...(request.toSlot ? { toSlot: request.toSlot } : {}),
            },
            date
          );
          setEntries(result.entries);
          setBanner(result.message ?? copiedMessage(result.copied, request.toSlot));
          // An empty source leaves the sheet open so the day can be re-picked.
          if (result.status === 'copied') {
            setCopyMealSheetOpen(false);
            setCopyToSlot(null);
          }
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
          await refreshDay(date);
        } finally {
          setBatchBusy(false);
        }
      })();
    },
    [date, refreshDay]
  );

  /** Push the current selection onto another day/slot via the bulk route. */
  const handleCopySelection = useCallback(
    (target: { toDate: string; toSlot: MealSlot }) => {
      void (async () => {
        const chosen = entries.filter((entry) => selectedIds.includes(entry.id));
        setBatchBusy(true);
        setBanner(null);
        try {
          const result = await copyMealEntriesTo(
            { entries: chosen, toDate: target.toDate, toSlot: target.toSlot },
            date
          );
          setEntries(result.entries);
          setBanner(result.message ?? copiedMessage(result.copied, target.toSlot));
          if (result.status === 'copied') exitSelect();
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
          await refreshDay(date);
        } finally {
          setBatchBusy(false);
        }
      })();
    },
    [entries, selectedIds, date, exitSelect, refreshDay]
  );

  const runBulkDelete = useCallback(
    (ids: string[]) => {
      void (async () => {
        setBatchBusy(true);
        setBanner(null);
        try {
          const result = await deleteMealEntries(ids, date);
          setEntries(result.entries);
          setBanner(result.message);
          if (result.status === 'partial') {
            // We know HOW MANY failed, not which. Re-deriving the selection from
            // the rows that survived leaves exactly the un-deleted ones ticked,
            // so "try again" retries the right subset instead of re-sending ids
            // the server has already dropped.
            const survivors = result.entries.filter((entry) => ids.includes(entry.id));
            setSelectedIds(survivors.map((entry) => entry.id));
          } else if (result.status === 'deleted') {
            exitSelect();
          }
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
          await refreshDay(date);
        } finally {
          setBatchBusy(false);
        }
      })();
    },
    [date, exitSelect, refreshDay]
  );

  const handleBulkDelete = useCallback(() => {
    const ids = [...selectedIds];
    /* istanbul ignore next -- the selection bar disables Delete while nothing is
       ticked and reads the same `selectedIds`, so this guard is unreachable from
       the UI; it stays so a future caller cannot raise "Delete 0 items". */
    if (ids.length === 0) return;
    Alert.alert(
      // Singularised, unlike the donor's "Delete 1 Items".
      `Delete ${ids.length} ${ids.length === 1 ? 'item' : 'items'}`,
      'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runBulkDelete(ids) },
      ]
    );
  }, [selectedIds, runBulkDelete]);

  /** Log a library food: the SERVER derives the serving for the portion asked. */
  const handleLogFood = useCallback(
    (food: FoodItem, portion: number) => {
      void (async () => {
        setBusyFoodId(food.id);
        setBanner(null);
        try {
          const result = await logFoodToDiary(food.id, { mealSlot: slot, portion, date });
          setFoods(result.foods);
          if (result.message) setBanner(result.message);
          if (result.status !== 'rejected') await refreshDay(date);
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
        } finally {
          setBusyFoodId(null);
        }
      })();
    },
    [slot, date, refreshDay]
  );

  const handleLogCalories = useCallback(
    (entryName: string, kcal: number) => {
      void (async () => {
        setBanner(null);
        try {
          setEntries(await addMealEntry({ name: entryName, slot, calories: kcal, date }));
        } catch {
          setBanner(WRITE_FAILED_MESSAGE);
        }
      })();
    },
    [slot, date]
  );

  const handleWater = async (delta: number) => {
    setWaterDay(await adjustWater(delta));
  };

  const handleCalorieGoal = useCallback(() => {
    Alert.alert('Daily calorie goal', 'Pick the target this day is measured against.', [
      ...[1500, 1800, 2000, 2500].map((value) => ({
        text: `${value} kcal`,
        onPress: () => void saveNutritionGoals({ calories: value }).then(setGoals),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, []);

  /** A slot opens by default once it has something in it. */
  const isExpanded = (groupSlot: MealSlot, count: number) =>
    expandedOverrides[groupSlot] ?? count > 0;

  /** The Add Food card opens by default on an empty day, shuts once it is not. */
  const addFoodExpanded = addFoodOverride ?? entries.length === 0;

  return (
    <HealthSectionScreen title="Nutrition" testID="health-nutrition-screen" loading={loading}>
      {/* Day stepper — the diary is per-day, and yesterday is one tap away */}
      <View style={styles.dayRow}>
        <Pressable
          onPress={() => setDate(shiftDateKey(date, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          testID="health-nutrition-prev-day"
          style={[styles.dayBtn, { borderColor: colors.borderColor }]}
        >
          <Icon name="chevron-back" size={18} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.dayLabelColumn}>
          <Typography
            variant="headline"
            weight="semibold"
            color={colors.textPrimary}
            testID="health-nutrition-day-label"
          >
            {formatDayKey(date)}
          </Typography>
          {!isToday ? (
            <Pressable
              onPress={() => setDate(todayDateKey())}
              accessibilityRole="button"
              accessibilityLabel="Jump back to today"
              testID="health-nutrition-today-button"
              hitSlop={8}
            >
              <Typography variant="caption1" weight="semibold" color={colors.primary}>
                Back to today
              </Typography>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => !isToday && setDate(shiftDateKey(date, 1))}
          disabled={isToday}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: isToday }}
          testID="health-nutrition-next-day"
          style={[styles.dayBtn, { borderColor: colors.borderColor, opacity: isToday ? 0.4 : 1 }]}
        >
          <Icon name="chevron-forward" size={18} color={colors.textPrimary} />
        </Pressable>
      </View>

      {banner ? (
        <Card
          variant="filled"
          style={[styles.banner, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-nutrition-banner"
        >
          <Typography variant="footnote" color={colors.textPrimary} style={styles.bannerText}>
            {banner}
          </Typography>
          <Pressable
            onPress={() => setBanner(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss message"
            testID="health-nutrition-banner-dismiss"
            hitSlop={8}
          >
            <Icon name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        </Card>
      ) : null}

      {/* Calories against the day's goal */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            CALORIES
          </Typography>
          <Pressable
            onPress={handleCalorieGoal}
            accessibilityRole="button"
            accessibilityLabel="Change calorie goal"
            testID="health-nutrition-goal-button"
          >
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              Goal {goals.calories}
            </Typography>
          </Pressable>
        </View>
        <HealthCalorieRingCard totals={totals} goals={goals} testID="health-nutrition" />
        <HealthStatTiles
          stats={[
            {
              label: overBy > 0 ? 'Over' : 'Remaining',
              value: `${overBy > 0 ? overBy : remaining} kcal`,
              icon: 'calories',
              testID: 'health-nutrition-remaining-tile',
            },
            {
              label: 'Items',
              value: String(entries.length),
              icon: 'meals',
              testID: 'health-nutrition-items-tile',
            },
            {
              label: 'Water',
              value: `${waterDay?.cups ?? 0}/${waterDay?.target ?? DEFAULT_WATER_TARGET}`,
              icon: 'hydration',
              testID: 'health-nutrition-water-tile',
            },
          ]}
        />
      </Card>

      <HealthTodayChallengesCard
        onManage={() => router.push('/health-challenges' as never)}
      />

      {/* Where the day's macros actually went — a glance, not a workspace,
          so it takes the tighter card. */}
      <Card
        variant="filled"
        style={[styles.card, styles.compactCard, { backgroundColor: colors.backgroundSecondary }]}
      >
        <HealthMacroBreakdown totals={totals} />
      </Card>

      {/* Add Food — one compact, collapsible card: quick add from the library,
          a manual fallback, and copying a meal in from elsewhere. Open by
          default while the day is empty (there is something to do here);
          shut once it is not, so a day that is mostly logged stays short. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Pressable
          onPress={() => setAddFoodOverride(!addFoodExpanded)}
          accessibilityRole="button"
          accessibilityLabel={`Add food, ${MEAL_SLOT_LABELS[slot]}`}
          accessibilityState={{ expanded: addFoodExpanded }}
          testID="health-add-food-toggle"
          style={styles.cardHead}
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            ADD FOOD
          </Typography>
          <View style={styles.groupMeta}>
            <Typography variant="footnote" color={colors.textSecondary}>
              {MEAL_SLOT_LABELS[slot]}
            </Typography>
            <Icon
              name={addFoodExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </View>
        </Pressable>

        {addFoodExpanded ? (
          <>
            <View style={[styles.slotRow, { borderColor: colors.borderColor }]}>
              {MEAL_SLOTS.map((option) => {
                const active = option === slot;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setSlot(option)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add to ${MEAL_SLOT_LABELS[option]}`}
                    accessibilityState={{ selected: active }}
                    testID={`health-meal-slot-${option}`}
                    style={[styles.slotOption, active && { backgroundColor: colors.primary }]}
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

            <View style={styles.addModeRow}>
              <View style={[styles.addModeTabs, { borderColor: colors.borderColor }]}>
                <Pressable
                  onPress={() => setAddMode('quick')}
                  accessibilityRole="button"
                  accessibilityLabel="Quick add"
                  accessibilityState={{ selected: addMode === 'quick' }}
                  testID="health-add-food-mode-quick"
                  style={[styles.addModeTab, addMode === 'quick' && { backgroundColor: colors.primary }]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={addMode === 'quick' ? colors.white : colors.textSecondary}
                  >
                    Quick Add
                  </Typography>
                </Pressable>
                <Pressable
                  onPress={() => setAddMode('manual')}
                  accessibilityRole="button"
                  accessibilityLabel="Manual entry"
                  accessibilityState={{ selected: addMode === 'manual' }}
                  testID="health-add-food-mode-manual"
                  style={[styles.addModeTab, addMode === 'manual' && { backgroundColor: colors.primary }]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={addMode === 'manual' ? colors.white : colors.textSecondary}
                  >
                    Manual
                  </Typography>
                </Pressable>
              </View>
              <Pressable
                onPress={openCopyMealSheet}
                accessibilityRole="button"
                accessibilityLabel={`Copy a meal into ${MEAL_SLOT_LABELS[slot]}`}
                testID="health-nutrition-copy-meal-toggle"
                hitSlop={8}
              >
                <Typography variant="caption1" weight="semibold" color={colors.primary}>
                  Copy meal
                </Typography>
              </Pressable>
            </View>

            {addMode === 'quick' ? (
              <HealthQuickAdd
                slot={slot}
                suggestions={suggestions}
                suggestionsUnavailable={suggestionsUnavailable}
                favorites={favorites}
                recents={recents}
                loading={foodsLoading}
                busyFoodId={busyFoodId}
                onLogFood={handleLogFood}
                onLogCalories={handleLogCalories}
                hideHeading
              />
            ) : (
              <>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="What did you eat?"
                  placeholderTextColor={colors.textSecondary}
                  returnKeyType="next"
                  accessibilityLabel="Food name"
                  testID="health-meal-name-input"
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                      backgroundColor: colors.backgroundMain,
                    },
                  ]}
                />
                <View style={styles.amountRow}>
                  <AmountField
                    label="kcal"
                    value={calories}
                    onChange={setCalories}
                    accessibilityLabel="Calories"
                    testID="health-meal-calories-input"
                  />
                  <AmountField
                    label="P (g)"
                    value={protein}
                    onChange={setProtein}
                    accessibilityLabel="Protein grams"
                    testID="health-meal-protein-input"
                  />
                  <AmountField
                    label="C (g)"
                    value={carbs}
                    onChange={setCarbs}
                    accessibilityLabel="Carb grams"
                    testID="health-meal-carbs-input"
                  />
                  <AmountField
                    label="F (g)"
                    value={fat}
                    onChange={setFat}
                    accessibilityLabel="Fat grams"
                    testID="health-meal-fat-input"
                  />
                </View>
                <Pressable
                  onPress={() => void handleAdd()}
                  disabled={!canAdd}
                  accessibilityRole="button"
                  accessibilityLabel="Add food"
                  accessibilityState={{ disabled: !canAdd }}
                  testID="health-meal-add-button"
                  style={[
                    styles.addButton,
                    { backgroundColor: canAdd ? colors.primary : colors.borderColor },
                  ]}
                >
                  <Icon name="add" size={18} color={colors.white} />
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Add to {MEAL_SLOT_LABELS[slot]}
                  </Typography>
                </Pressable>
              </>
            )}
          </>
        ) : null}
      </Card>

      {copyMealSheetOpen ? (
        <HealthCopyMealSheet
          visible
          onClose={() => setCopyMealSheetOpen(false)}
          toDate={date}
          toSlot={slot}
          busy={batchBusy}
          onCopy={handleCopyFrom}
          testID="health-nutrition-copy-meal"
        />
      ) : null}

      {entries.length === 0 ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-nutrition-empty"
        >
          <Typography variant="body" weight="semibold" color={colors.textPrimary}>
            {isToday ? 'Nothing logged today' : `Nothing logged on ${formatDayKey(date)}`}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            Add a food above, or pick one from quick add. Each meal keeps its own running total.
          </Typography>
        </Card>
      ) : null}

      {/* The day's diary, grouped the way it was eaten */}
      {grouped.map(({ slot: groupSlot, entries: slotEntries }) => {
        const selecting = selectingSlot === groupSlot;
        // A slot being selected in is always open — tick boxes inside a
        // collapsed card would be unreachable.
        const expanded = selecting || isExpanded(groupSlot, slotEntries.length);
        const slotTotals = sumNutrition(slotEntries);
        const copyOpen = copyToSlot === groupSlot;
        return (
          <Card
            key={groupSlot}
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
            testID={`health-meal-group-${groupSlot}`}
          >
            <View style={styles.cardHead}>
              <Pressable
                onPress={() =>
                  setExpandedOverrides((current) => ({ ...current, [groupSlot]: !expanded }))
                }
                accessibilityRole="button"
                accessibilityLabel={`${MEAL_SLOT_LABELS[groupSlot]}, ${slotEntries.length} ${
                  slotEntries.length === 1 ? 'item' : 'items'
                }, ${slotTotals.calories} kilocalories`}
                accessibilityState={{ expanded }}
                testID={`health-meal-group-${groupSlot}-toggle`}
                style={styles.groupToggle}
              >
                <View style={styles.groupTitle}>
                  <Icon name={MEAL_SLOT_ICONS[groupSlot]} size={18} color={colors.primary} />
                  <View>
                    <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                      {MEAL_SLOT_LABELS[groupSlot]}
                    </Typography>
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      testID={`health-meal-group-${groupSlot}-count`}
                    >
                      {slotEntries.length === 0
                        ? 'Nothing yet'
                        : `${slotEntries.length} ${slotEntries.length === 1 ? 'item' : 'items'}`}
                    </Typography>
                  </View>
                </View>
                <View style={styles.groupMeta}>
                  <Typography
                    variant="footnote"
                    color={colors.textSecondary}
                    testID={`health-meal-group-${groupSlot}-total`}
                  >
                    {slotTotals.calories} kcal
                  </Typography>
                  <Icon
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </View>
              </Pressable>

              {/* Siblings of the toggle, not children: a `Pressable` merges its
                  subtree into one accessibility element, so nesting these would
                  hide them from VoiceOver behind the expand/collapse label. */}
              <View style={styles.groupTools}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/health-add-food', params: { slot: groupSlot } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Add to ${MEAL_SLOT_LABELS[groupSlot]}`}
                  testID={`health-meal-group-${groupSlot}-add`}
                  style={[styles.toolButton, styles.toolButtonAccent, { backgroundColor: colors.primary }]}
                >
                  <Icon name="add" size={14} color={colors.white} />
                </Pressable>
                <Pressable
                  onPress={() => openCopyToSheet(groupSlot)}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy ${MEAL_SLOT_LABELS[groupSlot]} to another day or meal`}
                  accessibilityState={{ expanded: copyOpen }}
                  testID={`health-meal-group-${groupSlot}-copy`}
                  style={[
                    styles.toolButton,
                    { borderColor: copyOpen ? colors.primary : colors.borderColor },
                  ]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={copyOpen ? colors.primary : colors.textSecondary}
                  >
                    Copy
                  </Typography>
                </Pressable>
                {slotEntries.length > 0 ? (
                  <Pressable
                    onPress={() => startSelecting(groupSlot)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      selecting
                        ? `Stop selecting ${MEAL_SLOT_LABELS[groupSlot]} items`
                        : `Select ${MEAL_SLOT_LABELS[groupSlot]} items`
                    }
                    accessibilityState={{ selected: selecting }}
                    testID={`health-meal-group-${groupSlot}-select`}
                    style={[
                      styles.toolButton,
                      { borderColor: selecting ? colors.primary : colors.borderColor },
                    ]}
                  >
                    <Typography
                      variant="caption1"
                      weight="semibold"
                      color={selecting ? colors.primary : colors.textSecondary}
                    >
                      {selecting ? 'Done' : 'Select'}
                    </Typography>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {selecting ? (
              <HealthMealSelectionBar
                slot={groupSlot}
                fromDate={date}
                selectedCount={selectedIds.length}
                busy={batchBusy}
                onCancel={exitSelect}
                onDelete={handleBulkDelete}
                onCopy={handleCopySelection}
                testID={`health-meal-selection-${groupSlot}`}
              />
            ) : null}

            {expanded ? (
              <HealthMealDetail
                slot={groupSlot}
                entries={slotEntries}
                busyEntryId={busyEntryId}
                onSaveEntry={handleSaveEntry}
                onMoveEntry={handleMoveEntry}
                onDeleteEntry={handleDeleteEntry}
                onReportionEntry={handleReportionEntry}
                {...(selecting ? { selectedIds, onToggleSelect: toggleSelected } : {})}
              />
            ) : null}
          </Card>
        );
      })}

      {copyToSlot ? (
        <HealthCopyToSheet
          visible
          onClose={() => setCopyToSlot(null)}
          fromDate={date}
          fromSlot={copyToSlot}
          busy={batchBusy}
          onCopy={handleCopyFrom}
          testID={`health-meal-copy-to-${copyToSlot}`}
        />
      ) : null}

      {/* Hydration lives on Home too — same store, so both stay in step */}
      {isToday && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            WATER
          </Typography>
          <View style={styles.waterRow}>
            <Pressable
              onPress={() => void handleWater(-1)}
              accessibilityRole="button"
              accessibilityLabel="Remove a cup"
              testID="health-nutrition-water-minus"
              style={[styles.waterBtn, { borderColor: colors.borderColor }]}
            >
              <Icon name="remove" size={20} color={colors.textPrimary} />
            </Pressable>
            <Typography
              variant="body"
              weight="semibold"
              color={colors.textPrimary}
              testID="health-nutrition-water-count"
              accessibilityLabel={`${waterDay?.cups ?? 0} / ${
                waterDay?.target ?? DEFAULT_WATER_TARGET
              } cups`}
            >
              {waterDay?.cups ?? 0} / {waterDay?.target ?? DEFAULT_WATER_TARGET} cups
            </Typography>
            <Pressable
              onPress={() => void handleWater(1)}
              accessibilityRole="button"
              accessibilityLabel="Add a cup"
              testID="health-nutrition-water-plus"
              style={[
                styles.waterBtn,
                { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Icon name="add" size={20} color={colors.white} />
            </Pressable>
          </View>
        </Card>
      )}
    </HealthSectionScreen>
  );
}

/** Small labelled numeric field — four of them share the add-food row. */
function AmountField({
  label,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.amountField}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(sanitizeAmountInput(text))}
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[
          styles.amountInput,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLabelColumn: {
    alignItems: 'center',
    gap: 2,
  },
  dayBtn: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  /** Tighter than `card` — for a section that is a glance, not a workspace. */
  compactCard: {
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  banner: {
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  bannerText: {
    flex: 1,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  slotRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  slotOption: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  amountRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  amountField: {
    flex: 1,
    gap: Spacing.xxs,
  },
  amountInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  addModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  addModeTabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  addModeTab: {
    height: 34,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  groupTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginLeft: Spacing.sm,
  },
  toolButton: {
    height: 30,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolButtonAccent: {
    width: 30,
    paddingHorizontal: 0,
    borderWidth: 0,
  },
  groupTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  waterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  waterBtn: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
