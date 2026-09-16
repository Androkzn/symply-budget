/**
 * Symply Health WORKOUT LIBRARY tab — browse, filter, detail and "log this".
 *
 * Renders the REAL screens through <ThemeProvider> and drives the primary path:
 * load → filter → search → open → log. Only the storage-backed async functions
 * are mocked; the pure helpers stay real (they own their coverage in
 * ../../__tests__/healthExerciseStorage.test.ts).
 *
 * The invariant these suites exist to pin: **an injury-flagged exercise is
 * VISIBLY flagged and DE-PRIORITISED, and cannot be logged on one tap.** A
 * screen that renders the catalogue but swallows the flag would be worse than
 * no library at all.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  loadExerciseLibrary,
  logExercise,
  MISSING_EXERCISE_MESSAGE,
  searchExercises,
  setExerciseFavorite,
  type ExerciseItem,
  type ExerciseLibrary,
  type ExerciseWriteResult,
} from '../../healthExerciseStorage';
import { HealthExerciseDetailScreen } from '../HealthExerciseDetailScreen';
import { HealthWorkoutLibraryScreen } from '../HealthWorkoutLibraryScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthExerciseStorage', () => {
  const actual = jest.requireActual('../../healthExerciseStorage');
  return {
    ...actual,
    loadExerciseLibrary: jest.fn(),
    searchExercises: jest.fn(),
    setExerciseFavorite: jest.fn(),
    logExercise: jest.fn(),
  };
});

const mockLoad = loadExerciseLibrary as jest.Mock;
const mockSearch = searchExercises as jest.Mock;
const mockFavorite = setExerciseFavorite as jest.Mock;
const mockLog = logExercise as jest.Mock;

function exercise(over: Partial<ExerciseItem> = {}): ExerciseItem {
  return {
    id: over.id ?? 'ex_squat',
    name: over.name ?? 'Squat',
    aliases: over.aliases ?? ['squats'],
    category: over.category ?? 'strength',
    muscleGroups: over.muscleGroups ?? ['quads', 'glutes'],
    secondaryMuscles: over.secondaryMuscles ?? ['hamstrings'],
    equipment: over.equipment ?? ['none'],
    bodyParts: over.bodyParts ?? ['knee', 'hip'],
    difficulty: over.difficulty ?? 'level2',
    difficultyLevel: over.difficultyLevel ?? 2,
    instructions: over.instructions ?? 'Sit the hips back and down, then drive up.',
    illustration: over.illustration ?? 'strength',
    defaultMinutes: over.defaultMinutes ?? 10,
    workoutType: over.workoutType ?? 'strength',
    isFavorite: over.isFavorite ?? false,
    injuryFlag: over.injuryFlag ?? null,
    injuryBodyParts: over.injuryBodyParts ?? [],
    updatedAt: over.updatedAt ?? '2026-07-25T08:00:00.000Z',
  };
}

function library(over: Partial<ExerciseLibrary> = {}): ExerciseLibrary {
  return { exercises: over.exercises ?? [], injuries: over.injuries ?? [] };
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => node.props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

async function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  await act(async () => input(tree, testID).props.onChangeText(text));
}

/** A promise the test resolves by hand, for asserting an in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(library());
  mockSearch.mockResolvedValue([]);
  mockFavorite.mockImplementation(async () => ({
    library: library(),
    status: 'saved',
    message: null,
  }));
  mockLog.mockResolvedValue({ status: 'logged', message: 'Logged 10 min of Squat.', minutes: 10 });
});

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

describe('HealthWorkoutLibraryScreen', () => {
  it('HEALTH-EXUI-001: renders the shell and says so when nothing matches', async () => {
    const tree = await render(<HealthWorkoutLibraryScreen />);

    expect(byTestId(tree, 'health-exercises-screen').length).toBe(1);
    expect(byTestId(tree, 'health-exercises-screen-scroll-end').length).toBe(1);
    expect(byTestId(tree, 'health-exercises-empty').length).toBe(1);
    const text = allText(tree.toJSON());
    expect(text).toContain('SEARCH');
    expect(text).toContain('EXERCISES');
  });

  it('HEALTH-EXUI-002: a row shows the catalogue metadata the user browses by', async () => {
    mockLoad.mockResolvedValue(
      library({ exercises: [exercise({ id: 'ex_squat', name: 'Squat' })] })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
    const meta = allText(byTestId(tree, 'health-exercise-meta-ex_squat')[0]);
    expect(meta).toContain('Strength');
    expect(meta).toContain('Easy');
    expect(meta).toContain('Quads');
  });

  it('HEALTH-EXUI-003: no injury banner when nothing is injured', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise()] }));
    const tree = await render(<HealthWorkoutLibraryScreen />);
    expect(byTestId(tree, 'health-exercises-injury-banner')).toEqual([]);
    expect(byTestId(tree, 'health-exercise-flag-ex_squat')).toEqual([]);
  });

  it('HEALTH-EXUI-004: an active injury raises the banner ABOVE the list', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_squat', injuryFlag: 'avoid', injuryBodyParts: ['Left knee'] }),
          exercise({ id: 'ex_plank', name: 'Plank' }),
        ],
        injuries: [
          { bodyPart: 'Left knee', canonical: 'knee', maxPainLevel: 3, injuryCount: 1 },
        ],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    const banner = byTestId(tree, 'health-exercises-injury-banner');
    expect(banner.length).toBe(1);
    expect(allText(banner[0])).toContain('Left knee is healing');
    expect(allText(byTestId(tree, 'health-exercises-injury-summary')[0])).toContain(
      '1 exercise loads it'
    );
  });

  it('HEALTH-EXUI-005: a flagged row is VISIBLY flagged with the severity label', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_squat', injuryFlag: 'avoid', injuryBodyParts: ['knee'] }),
          exercise({ id: 'ex_curl', name: 'Bicep Curl', injuryFlag: 'caution', injuryBodyParts: ['wrist'] }),
        ],
        injuries: [{ bodyPart: 'knee', canonical: 'knee', maxPainLevel: 2, injuryCount: 1 }],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    const avoid = byTestId(tree, 'health-exercise-flag-ex_squat');
    expect(avoid.length).toBe(1);
    expect(allText(avoid[0])).toBe('Avoid for now');
    // The accessibility label carries the FULL sentence, so a screen reader
    // hears why, not just that.
    expect(avoid[0].props.accessibilityLabel).toContain('Avoid it until that has healed');

    expect(allText(byTestId(tree, 'health-exercise-flag-ex_curl')[0])).toBe('Take care');
  });

  it('HEALTH-EXUI-006: flagged rows are DE-PRIORITISED — safe work renders first', async () => {
    // The store hands the screen the Worker's ordering; the screen must not
    // re-sort a flagged movement back to the top.
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_plank', name: 'Plank' }),
          exercise({ id: 'ex_squat', name: 'Squat', injuryFlag: 'avoid', injuryBodyParts: ['knee'], isFavorite: true }),
        ],
        injuries: [{ bodyPart: 'knee', canonical: 'knee', maxPainLevel: 3, injuryCount: 1 }],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    const text = allText(tree.toJSON());
    expect(text.indexOf('Plank')).toBeLessThan(text.indexOf('Squat'));
  });

  it('HEALTH-EXUI-007: filter chips are derived from the catalogue and narrow the list', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_squat', name: 'Squat', category: 'strength', equipment: ['none'] }),
          exercise({ id: 'ex_dog', name: 'Downward Dog', category: 'yoga', equipment: ['yoga_mat'] }),
        ],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    // Chips exist because the catalogue contains those values.
    expect(byTestId(tree, 'health-exercises-filter-category-yoga').length).toBe(1);
    expect(byTestId(tree, 'health-exercises-filter-equipment-yoga_mat').length).toBe(1);

    await press(tree, 'health-exercises-filter-category-yoga');
    expect(byTestId(tree, 'health-exercise-row-ex_dog').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_squat')).toEqual([]);

    await press(tree, 'health-exercises-filter-clear');
    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
  });

  it('HEALTH-EXUI-008: the favourites filter narrows to starred rows', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_squat', name: 'Squat', isFavorite: true }),
          exercise({ id: 'ex_plank', name: 'Plank' }),
        ],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercises-filter-favorites');
    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_plank')).toEqual([]);
  });

  it('HEALTH-EXUI-009: typing searches the store and swaps the list for results', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockSearch.mockResolvedValue([exercise({ id: 'ex_plank', name: 'Plank' })]);
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'plank');
    expect(mockSearch).toHaveBeenCalledWith('plank');
    expect(byTestId(tree, 'health-exercise-row-ex_plank').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_squat')).toEqual([]);
    // Filters are hidden while searching — the server ranks the hits.
    expect(byTestId(tree, 'health-exercises-filters')).toEqual([]);

    await press(tree, 'health-exercises-search-clear');
    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
  });

  it('HEALTH-EXUI-010: an empty search result says so instead of blanking', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise()] }));
    mockSearch.mockResolvedValue([]);
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'kayaking');
    expect(byTestId(tree, 'health-exercises-search-empty').length).toBe(1);
  });

  it('HEALTH-EXUI-011: the star toggles the favourite through the store', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockFavorite.mockResolvedValue({
      library: library({ exercises: [exercise({ id: 'ex_squat', isFavorite: true })] }),
      status: 'saved',
      message: null,
    });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercise-favorite-ex_squat');
    expect(mockFavorite).toHaveBeenCalledWith('ex_squat', true);
  });

  it('HEALTH-EXUI-012: an offline write surfaces the friendly message, never a raw error', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockFavorite.mockResolvedValue({
      library: library({ exercises: [exercise({ id: 'ex_squat', isFavorite: true })] }),
      status: 'offline',
      message: 'Saved on this device — it will sync when you are back online.',
    });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercise-favorite-ex_squat');
    const message = byTestId(tree, 'health-exercises-message');
    expect(message.length).toBe(1);
    expect(allText(message[0])).toContain('sync when you are back online');
  });

  it('HEALTH-EXUI-013: tapping a row opens the detail sheet', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    const tree = await render(<HealthWorkoutLibraryScreen />);

    expect(byTestId(tree, 'health-exercise-detail-instructions')).toEqual([]);
    await press(tree, 'health-exercise-open-ex_squat');
    expect(byTestId(tree, 'health-exercise-detail-instructions').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

describe('HealthExerciseDetailScreen', () => {
  const noop = () => undefined;

  it('HEALTH-EXUI-020: shows instructions, target muscles and difficulty', async () => {
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );

    expect(allText(byTestId(tree, 'health-exercise-detail-instructions')[0])).toContain(
      'Sit the hips back'
    );
    expect(allText(byTestId(tree, 'health-exercise-detail-primary')[0])).toBe('Quads, Glutes');
    expect(allText(byTestId(tree, 'health-exercise-detail-secondary')[0])).toContain('hamstrings');
    expect(allText(byTestId(tree, 'health-exercise-detail-difficulty')[0])).toContain('Easy');
    expect(allText(byTestId(tree, 'health-exercise-detail-category')[0])).toBe('Strength');
  });

  it('HEALTH-EXUI-021: no injury card on a clear exercise', async () => {
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );
    expect(byTestId(tree, 'health-exercise-detail-injury')).toEqual([]);
  });

  it('HEALTH-EXUI-022: a flagged exercise leads with the warning, not the instructions', async () => {
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ injuryFlag: 'avoid', injuryBodyParts: ['Left knee'] })}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );

    const card = byTestId(tree, 'health-exercise-detail-injury');
    expect(card.length).toBe(1);
    expect(allText(card[0])).toContain('Avoid for now');
    expect(allText(card[0])).toContain('This loads your left knee');
    // The banner must sit ABOVE the instructions a user would start following.
    const text = allText(tree.toJSON());
    expect(text.indexOf('Avoid for now')).toBeLessThan(text.indexOf('HOW TO DO IT'));
  });

  it('HEALTH-EXUI-023: "log this" defaults to the catalogue duration and calls back', async () => {
    const onLog = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ defaultMinutes: 12 })}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={onLog}
      />
    );

    expect(input(tree, 'health-exercise-minutes-input').props.value).toBe('12');
    await press(tree, 'health-exercise-log-button');
    expect(onLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex_squat' }), 12, false);
  });

  it('HEALTH-EXUI-024: the minutes field stays numeric however text arrives', async () => {
    const onLog = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={onLog}
      />
    );

    // `keyboardType` only picks a keyboard — paste and UI automation still
    // deliver letters.
    await type(tree, 'health-exercise-minutes-input', '2a5');
    expect(input(tree, 'health-exercise-minutes-input').props.value).toBe('25');
    await press(tree, 'health-exercise-log-button');
    expect(onLog).toHaveBeenCalledWith(expect.anything(), 25, false);
  });

  it('HEALTH-EXUI-025: a blank duration cannot be logged', async () => {
    const onLog = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={onLog}
      />
    );

    await type(tree, 'health-exercise-minutes-input', '');
    await press(tree, 'health-exercise-log-button');
    expect(onLog).not.toHaveBeenCalled();
  });

  it('HEALTH-EXUI-026: an AVOID exercise takes TWO taps — the first only confirms', async () => {
    const onLog = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ injuryFlag: 'avoid', injuryBodyParts: ['knee'] })}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={onLog}
      />
    );

    await press(tree, 'health-exercise-log-button');
    // First tap: nothing is logged, the screen asks again.
    expect(onLog).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-exercise-log-confirm').length).toBe(1);

    await press(tree, 'health-exercise-log-button');
    // Second tap carries the acknowledgement the store demands.
    expect(onLog).toHaveBeenCalledWith(expect.anything(), 10, true);
  });

  it('HEALTH-EXUI-027: a CAUTION exercise logs on the first tap', async () => {
    const onLog = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ injuryFlag: 'caution', injuryBodyParts: ['wrist'] })}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={onLog}
      />
    );

    await press(tree, 'health-exercise-log-button');
    expect(onLog).toHaveBeenCalledWith(expect.anything(), 10, false);
    expect(byTestId(tree, 'health-exercise-log-confirm')).toEqual([]);
  });

  it('HEALTH-EXUI-028: favourite and close call back', async () => {
    const onToggleFavorite = jest.fn();
    const onClose = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={onClose}
        onToggleFavorite={onToggleFavorite}
        onLog={noop}
      />
    );

    await press(tree, 'health-exercise-detail-favorite');
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex_squat' }));

    await press(tree, 'health-exercise-detail-close');
    expect(onClose).toHaveBeenCalled();
  });

  it('HEALTH-EXUI-029: every control carries a testID AND an accessibility label', async () => {
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ injuryFlag: 'avoid', injuryBodyParts: ['knee'] })}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );

    for (const id of [
      'health-exercise-detail-close',
      'health-exercise-log-button',
      'health-exercise-detail-favorite',
      'health-exercise-minutes-input',
    ]) {
      const node = tree.root.find((n) => n.props?.testID === id && !!n.props?.accessibilityLabel);
      expect(node).toBeTruthy();
    }
  });

  /* ---------------------------------------------------------------- */
  /* Sparse catalogue rows and the favourited state                    */
  /* ---------------------------------------------------------------- */

  it('HEALTH-EXUI-032: a sparse catalogue row reads as words, never as a blank line', async () => {
    // The seeded catalogue is complete, but `/health/exercises` serves whatever
    // the migration loaded. A movement with no equipment, no tagged muscles and
    // no instructions must still describe itself — three empty lines under three
    // headings reads as a screen that failed to load.
    const tree = await render(
      <HealthExerciseDetailScreen
        // `instructions` is set literally: the `exercise()` helper's `??`
        // default would fill the very null this case is about.
        exercise={{
          ...exercise({ equipment: [], muscleGroups: [], secondaryMuscles: [] }),
          instructions: null,
        }}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );

    expect(allText(tree.toJSON())).toContain('Equipment: None');
    expect(allText(byTestId(tree, 'health-exercise-detail-primary')[0])).toBe('Whole body');
    expect(allText(byTestId(tree, 'health-exercise-detail-instructions')[0])).toBe(
      'No instructions for this movement yet.'
    );
    // With nothing secondary to name, that line is absent rather than empty.
    expect(byTestId(tree, 'health-exercise-detail-secondary')).toEqual([]);
  });

  it('HEALTH-EXUI-033: a favourited movement says it is IN your favourites', async () => {
    // The star is the only affordance whose meaning inverts, so its label, its
    // glyph and its VoiceOver text all have to invert together — a stale "Add
    // to favourites" on an already-starred row un-stars it on the next tap.
    const onToggleFavorite = jest.fn();
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise({ isFavorite: true })}
        onClose={noop}
        onToggleFavorite={onToggleFavorite}
        onLog={noop}
      />
    );

    const star = tree.root.find(
      (n) =>
        n.props?.testID === 'health-exercise-detail-favorite' &&
        typeof n.props?.onPress === 'function'
    );
    expect(star.props.accessibilityLabel).toBe('Remove Squat from favourites');
    expect(star.props.accessibilityState).toEqual({ selected: true });
    expect(allText(byTestId(tree, 'health-exercise-detail-favorite')[0])).toContain(
      'In your favourites'
    );
    expect(allText(tree.toJSON())).not.toContain('Add to favourites');

    await press(tree, 'health-exercise-detail-favorite');
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ isFavorite: true }));
  });

  it('HEALTH-EXUI-034: a non-string in the minutes field clears it rather than crashing', async () => {
    // Same guard the other numeric Health fields carry: `keyboardType` is a
    // hint, and `.replace` on a non-string throws out of the change handler.
    const tree = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );

    await act(async () =>
      input(tree, 'health-exercise-minutes-input').props.onChangeText(
        undefined as unknown as string
      )
    );
    expect(input(tree, 'health-exercise-minutes-input').props.value).toBe('');
  });

  it('HEALTH-EXUI-035: Android gets the numeric keypad, iOS the number pad', async () => {
    // `number-pad` does not exist on Android — asking for it there falls back to
    // a full keyboard, which is exactly what the field is trying to avoid.
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      const tree = await render(
        <HealthExerciseDetailScreen
          exercise={exercise()}
          onClose={noop}
          onToggleFavorite={noop}
          onLog={noop}
        />
      );
      expect(input(tree, 'health-exercise-minutes-input').props.keyboardType).toBe('numeric');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }

    const ios = await render(
      <HealthExerciseDetailScreen
        exercise={exercise()}
        onClose={noop}
        onToggleFavorite={noop}
        onLog={noop}
      />
    );
    expect(input(ios, 'health-exercise-minutes-input').props.keyboardType).toBe('number-pad');
  });
});

/* ------------------------------------------------------------------ */
/* Library → detail → log, end to end                                  */
/* ------------------------------------------------------------------ */

describe('HealthWorkoutLibraryScreen — log this', () => {
  it('HEALTH-EXUI-030: logging a clear exercise closes the sheet and reports back', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercise-open-ex_squat');
    await press(tree, 'health-exercise-log-button');

    expect(mockLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'ex_squat' }), {
      minutes: 10,
      acknowledgeInjury: false,
    });
    expect(byTestId(tree, 'health-exercise-detail-instructions')).toEqual([]);
    expect(allText(byTestId(tree, 'health-exercises-message')[0])).toContain('Logged 10 min');
  });

  it('HEALTH-EXUI-047: the sheet opened from a row stars and closes through the LIST', async () => {
    // The sheet is rendered by the library screen, so its star and its close are
    // the list's callbacks — a sheet that only worked when rendered standalone
    // would leave both inert everywhere a user can actually reach them.
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockFavorite.mockResolvedValue({
      library: library({ exercises: [exercise({ id: 'ex_squat', isFavorite: true })] }),
      status: 'saved',
      message: null,
    });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercise-open-ex_squat');
    await press(tree, 'health-exercise-detail-favorite');
    expect(mockFavorite).toHaveBeenCalledWith('ex_squat', true);
    // The sheet re-reads the starred row, so its own label inverts with it.
    expect(
      tree.root.find(
        (n) =>
          n.props?.testID === 'health-exercise-detail-favorite' &&
          typeof n.props?.onPress === 'function'
      ).props.accessibilityLabel
    ).toBe('Remove Squat from favourites');

    await press(tree, 'health-exercise-detail-close');
    expect(byTestId(tree, 'health-exercise-detail-instructions')).toEqual([]);
  });

  it('HEALTH-EXUI-031: a BLOCKED log keeps the sheet open and explains why', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [exercise({ id: 'ex_squat', injuryFlag: 'avoid', injuryBodyParts: ['knee'] })],
        injuries: [{ bodyPart: 'knee', canonical: 'knee', maxPainLevel: 3, injuryCount: 1 }],
      })
    );
    mockLog.mockResolvedValue({
      status: 'blocked',
      message: 'This movement loads an injury you have logged. Confirm before recording it.',
      minutes: null,
    });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercise-open-ex_squat');
    // Two taps because the exercise is flagged; the store still refuses.
    await press(tree, 'health-exercise-log-button');
    await press(tree, 'health-exercise-log-button');

    // The sheet stays open so the warning is still on screen.
    expect(byTestId(tree, 'health-exercise-detail-instructions').length).toBe(1);
    expect(allText(byTestId(tree, 'health-exercise-detail-message')[0])).toContain(
      'Confirm before recording it'
    );
  });
});

/* ------------------------------------------------------------------ */
/* Search results are their own list — favourites, races and opening   */
/* ------------------------------------------------------------------ */

describe('HealthWorkoutLibraryScreen — the search hit list', () => {
  const hits = [
    exercise({ id: 'ex_plank', name: 'Plank' }),
    exercise({ id: 'ex_curl', name: 'Bicep Curl' }),
  ];

  it('HEALTH-EXUI-040: starring a SEARCH HIT re-stars that hit, and only that one', async () => {
    // `/exercises?search=` answers with its OWN ranked list; the favourite write
    // answers with the CATALOGUE. Nothing joins the two, so a hit the catalogue
    // has not cached would silently un-star itself on the next render.
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockSearch.mockResolvedValue(hits);
    mockFavorite.mockResolvedValue({ library: library(), status: 'saved', message: null });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'pl');
    await press(tree, 'health-exercise-favorite-ex_plank');

    expect(mockFavorite).toHaveBeenCalledWith('ex_plank', true);
    expect(byTestId(tree, 'health-exercise-favorite-ex_plank')[0].props.accessibilityState).toEqual(
      { selected: true }
    );
    expect(byTestId(tree, 'health-exercise-favorite-ex_curl')[0].props.accessibilityState).toEqual({
      selected: false,
    });
    // Patched in place — the screen did not re-run the search to find out.
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('HEALTH-EXUI-041: a REFUSED star does not stay lit on the hit', async () => {
    // The store rolls a rejected favourite back in the catalogue. The hits are
    // the only rows on screen while a query is active, so leaving one starred
    // shows the user a favourite the Worker has just refused to keep.
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockSearch.mockResolvedValue(hits);
    mockFavorite.mockResolvedValue({
      library: library({ exercises: [exercise({ id: 'ex_squat' })] }),
      status: 'rejected',
      message: MISSING_EXERCISE_MESSAGE,
    });
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'pl');
    await press(tree, 'health-exercise-favorite-ex_plank');

    expect(byTestId(tree, 'health-exercise-favorite-ex_plank')[0].props.accessibilityState).toEqual(
      { selected: false }
    );
    expect(allText(byTestId(tree, 'health-exercises-message')[0])).toBe(MISSING_EXERCISE_MESSAGE);
  });

  it('HEALTH-EXUI-042: clearing the search mid-write does not bring the hits back', async () => {
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockSearch.mockResolvedValue(hits);
    const write = deferred<ExerciseWriteResult>();
    mockFavorite.mockReturnValue(write.promise);
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'pl');
    await press(tree, 'health-exercise-favorite-ex_plank');
    // The user gives up on the search while the star is still in flight.
    await press(tree, 'health-exercises-search-clear');
    await act(async () => {
      write.resolve({
        library: library({ exercises: [exercise({ id: 'ex_squat' })] }),
        status: 'saved',
        message: null,
      });
    });

    expect(byTestId(tree, 'health-exercise-row-ex_plank')).toEqual([]);
    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
  });

  it('HEALTH-EXUI-043: an answer that arrives after the query moved on is discarded', async () => {
    // Typing is faster than the network, so the first request routinely lands
    // last. Rendering it would show hits for a needle the field no longer holds.
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    const answers: Array<(hits: ExerciseItem[]) => void> = [];
    mockSearch.mockImplementation(
      () =>
        new Promise<ExerciseItem[]>((resolve) => {
          answers.push(resolve);
        })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'sq');
    await type(tree, 'health-exercises-search-input', 'squ');
    await act(async () => answers[0]([exercise({ id: 'ex_stale', name: 'Stale hit' })]));
    expect(byTestId(tree, 'health-exercise-row-ex_stale')).toEqual([]);

    await act(async () => answers[1]([exercise({ id: 'ex_fresh', name: 'Fresh hit' })]));
    expect(byTestId(tree, 'health-exercise-row-ex_fresh').length).toBe(1);
  });

  it('HEALTH-EXUI-044: a hit the CATALOGUE does not hold still opens', async () => {
    // The search route ranks server-side over the whole table; the catalogue is
    // a cached snapshot. A movement added since that snapshot — or every hit at
    // all when the catalogue read failed — exists only in the results, and
    // tapping one used to do nothing whatsoever.
    mockLoad.mockResolvedValue(library({ exercises: [exercise({ id: 'ex_squat' })] }));
    mockSearch.mockResolvedValue([
      exercise({ id: 'ex_new', name: 'Nordic Curl', instructions: 'Lower under control.' }),
    ]);
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await type(tree, 'health-exercises-search-input', 'nordic');
    await press(tree, 'health-exercise-open-ex_new');

    expect(allText(byTestId(tree, 'health-exercise-detail-instructions')[0])).toBe(
      'Lower under control.'
    );
  });
});

/* ------------------------------------------------------------------ */
/* The rest of the browse surface                                      */
/* ------------------------------------------------------------------ */

describe('HealthWorkoutLibraryScreen — browsing', () => {
  const catalogue = library({
    exercises: [
      exercise({
        id: 'ex_squat',
        name: 'Squat',
        muscleGroups: ['quads'],
        secondaryMuscles: [],
        equipment: ['none'],
        difficulty: 'level2',
        category: 'strength',
      }),
      exercise({
        id: 'ex_dog',
        name: 'Downward Dog',
        muscleGroups: ['hamstrings'],
        secondaryMuscles: [],
        equipment: ['yoga_mat'],
        difficulty: 'level1',
        category: 'yoga',
      }),
    ],
  });

  it('HEALTH-EXUI-045: muscle, equipment and difficulty each narrow the list', async () => {
    mockLoad.mockResolvedValue(catalogue);
    const tree = await render(<HealthWorkoutLibraryScreen />);

    await press(tree, 'health-exercises-filter-muscle-quads');
    expect(byTestId(tree, 'health-exercise-row-ex_squat').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_dog')).toEqual([]);

    // "All" is a real option, not decoration: it puts the row back to any.
    await press(tree, 'health-exercises-filter-muscle-all');
    expect(byTestId(tree, 'health-exercise-row-ex_dog').length).toBe(1);

    await press(tree, 'health-exercises-filter-equipment-yoga_mat');
    expect(byTestId(tree, 'health-exercise-row-ex_dog').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_squat')).toEqual([]);

    await press(tree, 'health-exercises-filter-clear');
    await press(tree, 'health-exercises-filter-difficulty-level1');
    expect(byTestId(tree, 'health-exercise-row-ex_dog').length).toBe(1);
    expect(byTestId(tree, 'health-exercise-row-ex_squat')).toEqual([]);
  });

  it('HEALTH-EXUI-046: TWO healing injuries are named together, in the plural', async () => {
    mockLoad.mockResolvedValue(
      library({
        exercises: [
          exercise({ id: 'ex_squat', injuryFlag: 'avoid', injuryBodyParts: ['Left knee'] }),
          exercise({ id: 'ex_row', name: 'Row', injuryFlag: 'caution', injuryBodyParts: ['back'] }),
        ],
        injuries: [
          { bodyPart: 'Left knee', canonical: 'knee', maxPainLevel: 3, injuryCount: 1 },
          { bodyPart: 'lower_back', canonical: 'back', maxPainLevel: 2, injuryCount: 1 },
        ],
      })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    const banner = byTestId(tree, 'health-exercises-injury-banner');
    expect(allText(banner[0])).toContain('Left knee and Lower back are healing');
    // Two injuries load two movements — "1 exercise loads it" would be a lie
    // about both the count and which injury is meant.
    expect(allText(byTestId(tree, 'health-exercises-injury-summary')[0])).toBe(
      '2 exercises load them — flagged and moved to the bottom.'
    );
  });

  it('HEALTH-EXUI-048: a row with no tagged muscles reads "Whole body"', async () => {
    // The catalogue is whatever the migration loaded. "Strength · Easy · " with
    // nothing after it reads as a row that failed to load.
    mockLoad.mockResolvedValue(
      library({ exercises: [exercise({ id: 'ex_burpee', name: 'Burpee', muscleGroups: [] })] })
    );
    const tree = await render(<HealthWorkoutLibraryScreen />);

    expect(allText(byTestId(tree, 'health-exercise-meta-ex_burpee')[0])).toBe(
      'Strength · Easy · Whole body'
    );
  });
});
