import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  categoryLabel,
  deriveFacets,
  difficultyLabel,
  EMPTY_EXERCISE_FILTER,
  humanizeToken,
  injuryWarningFor,
  INJURY_FLAG_LABELS,
  isFilterActive,
  loadExerciseLibrary,
  logExercise,
  searchExercises,
  setExerciseFavorite,
  viewExercises,
  type ActiveInjury,
  type ExerciseFilter,
  type ExerciseItem,
  type ExerciseLibrary,
} from '../healthExerciseStorage';

import { HealthExerciseDetailScreen } from './HealthExerciseDetailScreen';

/**
 * Workout library — the donor's exercise catalogue, browsable and filterable.
 *
 * Everything on this screen comes from the `symply-health-api` Worker: the
 * catalogue itself, the favourite flag, and — most importantly — the INJURY
 * VERDICT. The screen renders `injuryFlag` and de-prioritises by it; it never
 * decides for itself which movements a user should avoid (see
 * `healthExerciseStorage`).
 *
 * The injury banner is deliberately loud and sits ABOVE the list: a user who
 * has logged an injury needs to know the library is filtering for them before
 * they start scrolling, not after they have picked something.
 *
 * Workout VIDEOS and AI-generated routines are the donor's P3/P4 surfaces and
 * are not here.
 */

const ALL = 'all';

export function HealthWorkoutLibraryScreen() {
  const colors = useAppColors();

  const [library, setLibrary] = useState<ExerciseLibrary>({ exercises: [], injuries: [] });
  const [filter, setFilter] = useState<ExerciseFilter>({ ...EMPTY_EXERCISE_FILTER });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExerciseItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    setLibrary(await loadExerciseLibrary());
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Live search against /exercises?search=; a failed request degrades to a
  // substring match on the cached catalogue inside the store, so this never
  // blanks the list.
  useEffect(() => {
    let cancelled = false;
    const needle = query.trim();
    if (needle.length === 0) {
      setResults(null);
      return undefined;
    }
    void searchExercises(needle).then((hits) => {
      if (!cancelled) setResults(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const searching = query.trim().length > 0;
  const facets = useMemo(() => deriveFacets(library.exercises), [library.exercises]);
  const visible = useMemo(
    () => (results !== null ? results : viewExercises(library.exercises, filter)),
    [results, library.exercises, filter]
  );
  const selected = useMemo(() => {
    const cached = library.exercises.find((e) => e.id === selectedId);
    if (cached) return cached;
    // A server-ranked search HIT is not necessarily in the cached catalogue: a
    // movement added since the last full load — or any hit at all when the
    // catalogue read failed and the search did not — exists only in `results`.
    // Resolving the sheet from the library alone made tapping such a row do
    // nothing at all.
    return results?.find((e) => e.id === selectedId) ?? null;
  }, [library.exercises, results, selectedId]);
  const flaggedCount = useMemo(
    () => library.exercises.filter((e) => e.injuryFlag !== null).length,
    [library.exercises]
  );

  const setFilterField = useCallback(
    <K extends keyof ExerciseFilter>(key: K, value: ExerciseFilter[K]) => {
      setFilter((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const handleFavorite = async (exercise: ExerciseItem) => {
    const result = await setExerciseFavorite(exercise.id, !exercise.isFavorite);
    setLibrary(result.library);
    setMessage(result.message);
    if (results !== null) {
      // Keep the visible search hits in step without paying for a second call.
      // A REJECTED write was rolled back inside the store, so the hits have to
      // roll back with it — otherwise the star the Worker refused stays lit on
      // the only rows the user can currently see.
      const applied = result.status === 'rejected' ? exercise.isFavorite : !exercise.isFavorite;
      setResults(
        (current) =>
          current?.map((item) =>
            item.id === exercise.id ? { ...item, isFavorite: applied } : item
          ) ?? null
      );
    }
  };

  const handleLog = async (exercise: ExerciseItem, minutes: number, acknowledged: boolean) => {
    const result = await logExercise(exercise, { minutes, acknowledgeInjury: acknowledged });
    setMessage(result.message);
    if (result.status !== 'blocked') setSelectedId(null);
  };

  return (
    <HealthSectionScreen title="Workouts" testID="health-exercises-screen" loading={loading}>
      {/* Injury banner — above everything, because it changes what the list means */}
      {library.injuries.length > 0 && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-exercises-injury-banner"
        >
          <View style={styles.warningHead}>
            <Icon name="warning" size={18} color={colors.warning} />
            <Typography variant="footnote" weight="semibold" color={colors.warning}>
              {injuryHeadline(library.injuries)}
            </Typography>
          </View>
          <Typography
            variant="caption1"
            color={colors.textSecondary}
            testID="health-exercises-injury-summary"
          >
            {flaggedCount === 1
              ? '1 exercise loads it — flagged and moved to the bottom.'
              : `${flaggedCount} exercises load them — flagged and moved to the bottom.`}
          </Typography>
        </Card>
      )}

      {/* Search */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          SEARCH
        </Typography>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search exercises"
            testID="health-exercises-search-input"
            style={[
              styles.input,
              styles.searchInput,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          {searching && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="health-exercises-search-clear"
              style={[styles.iconButton, { borderColor: colors.borderColor }]}
            >
              <Icon name="close" size={18} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
      </Card>

      {/* Filters — the chips are DERIVED from the catalogue, so a library that
          grows a new muscle group becomes filterable with no app release. */}
      {!searching && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-exercises-filters"
        >
          <View style={styles.cardHead}>
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              FILTER
            </Typography>
            {isFilterActive(filter) && (
              <Pressable
                onPress={() => setFilter({ ...EMPTY_EXERCISE_FILTER })}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                testID="health-exercises-filter-clear"
              >
                <Typography variant="footnote" weight="semibold" color={colors.primary}>
                  Clear
                </Typography>
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={() => setFilterField('favoritesOnly', !filter.favoritesOnly)}
            accessibilityRole="button"
            accessibilityLabel="Show favourites only"
            accessibilityState={{ selected: filter.favoritesOnly }}
            testID="health-exercises-filter-favorites"
            style={[
              styles.chip,
              {
                backgroundColor: filter.favoritesOnly ? colors.primary : colors.backgroundMain,
                borderColor: colors.borderColor,
              },
            ]}
          >
            <Typography
              variant="caption1"
              weight="semibold"
              color={filter.favoritesOnly ? colors.white : colors.textSecondary}
            >
              Favourites
            </Typography>
          </Pressable>

          <FilterRow
            label="Muscle"
            prefix="muscle"
            options={facets.muscleGroups}
            selected={filter.muscleGroup}
            onSelect={(value) => setFilterField('muscleGroup', value)}
            labelFor={humanizeToken}
          />
          <FilterRow
            label="Equipment"
            prefix="equipment"
            options={facets.equipment}
            selected={filter.equipment}
            onSelect={(value) => setFilterField('equipment', value)}
            labelFor={humanizeToken}
          />
          <FilterRow
            label="Difficulty"
            prefix="difficulty"
            options={facets.difficulties}
            selected={filter.difficulty}
            onSelect={(value) => setFilterField('difficulty', value)}
            labelFor={difficultyLabel}
          />
          <FilterRow
            label="Category"
            prefix="category"
            options={facets.categories}
            selected={filter.category}
            onSelect={(value) => setFilterField('category', value)}
            labelFor={categoryLabel}
          />
        </Card>
      )}

      {message && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-exercises-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* The catalogue (or the search results when a query is active) */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          {searching ? 'RESULTS' : 'EXERCISES'}
        </Typography>
        {visible.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID={searching ? 'health-exercises-search-empty' : 'health-exercises-empty'}
          >
            {searching
              ? 'No exercise matches that.'
              : 'No exercises match these filters. Clear one to see more.'}
          </Typography>
        ) : (
          visible.map((exercise) => (
            <ExerciseRow
              key={exercise.id}
              exercise={exercise}
              onOpen={() => setSelectedId(exercise.id)}
              onFavorite={() => void handleFavorite(exercise)}
            />
          ))
        )}
      </Card>

      {selected && (
        <HealthExerciseDetailScreen
          exercise={selected}
          message={message}
          onClose={() => setSelectedId(null)}
          onToggleFavorite={(exercise) => void handleFavorite(exercise)}
          onLog={(exercise, minutes, acknowledged) =>
            void handleLog(exercise, minutes, acknowledged)
          }
        />
      )}
    </HealthSectionScreen>
  );
}

/** "Knee and lower back are healing" — the user's own words, never a token. */
function injuryHeadline(injuries: ActiveInjury[]): string {
  const names = injuries.map((i) => humanizeToken(i.bodyPart));
  if (names.length === 1) return `${names[0]} is healing`;
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1]} are healing`;
}

/** One horizontal band of mutually-exclusive chips, with an "All" reset. */
function FilterRow({
  label,
  prefix,
  options,
  selected,
  onSelect,
  labelFor,
}: {
  label: string;
  prefix: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  labelFor: (value: string) => string;
}) {
  const colors = useAppColors();
  if (options.length === 0) return null;
  return (
    <View style={styles.filterRow} testID={`health-exercises-filter-row-${prefix}`}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <View style={styles.chipWrap}>
        {[ALL, ...options].map((option) => {
          const value = option === ALL ? null : option;
          const active = selected === value;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(value)}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option === ALL ? 'All' : labelFor(option)}`}
              accessibilityState={{ selected: active }}
              testID={`health-exercises-filter-${prefix}-${option}`}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.backgroundMain,
                  borderColor: colors.borderColor,
                },
              ]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {option === ALL ? 'All' : labelFor(option)}
              </Typography>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function ExerciseRow({
  exercise,
  onOpen,
  onFavorite,
}: {
  exercise: ExerciseItem;
  onOpen: () => void;
  onFavorite: () => void;
}) {
  const colors = useAppColors();
  const warning = injuryWarningFor(exercise);
  // `warning` is non-null exactly when `injuryFlag` is, so the label reads off
  // the one comparison the colour already makes rather than a second fallback
  // for a state that cannot happen.
  const avoid = exercise.injuryFlag === 'avoid';
  const flagColor = avoid ? colors.error : colors.warning;

  return (
    <View
      testID={`health-exercise-row-${exercise.id}`}
      style={[styles.row, { borderTopColor: colors.borderColor }]}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${exercise.name}`}
        testID={`health-exercise-open-${exercise.id}`}
        style={styles.rowText}
      >
        <Typography variant="body" color={colors.textPrimary}>
          {exercise.name}
        </Typography>
        <Typography
          variant="caption1"
          color={colors.textSecondary}
          testID={`health-exercise-meta-${exercise.id}`}
        >
          {categoryLabel(exercise.category)} · {difficultyLabel(exercise.difficulty)} ·{' '}
          {exercise.muscleGroups.length === 0
            ? 'Whole body'
            : exercise.muscleGroups.map(humanizeToken).join(', ')}
        </Typography>
        {warning && (
          <View style={styles.warningHead}>
            <Icon name="warning" size={14} color={flagColor} />
            <Typography
              variant="caption1"
              weight="semibold"
              color={flagColor}
              testID={`health-exercise-flag-${exercise.id}`}
              accessibilityLabel={warning}
            >
              {INJURY_FLAG_LABELS[avoid ? 'avoid' : 'caution']}
            </Typography>
          </View>
        )}
      </Pressable>
      <Pressable
        onPress={onFavorite}
        accessibilityRole="button"
        accessibilityLabel={
          exercise.isFavorite
            ? `Remove ${exercise.name} from favourites`
            : `Add ${exercise.name} to favourites`
        }
        accessibilityState={{ selected: exercise.isFavorite }}
        testID={`health-exercise-favorite-${exercise.id}`}
        hitSlop={8}
      >
        <Icon
          name={exercise.isFavorite ? 'star' : 'star-outline'}
          size={18}
          color={exercise.isFavorite ? colors.primary : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
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
  searchInput: {
    flex: 1,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    gap: Spacing.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  warningHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
});
