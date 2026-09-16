/**
 * Symply Health FOOD CHALLENGES screen — create, edit, pause/resume, delete.
 *
 * `HealthChallengesScreen.tsx` (490 lines) shipped with the Dashboard parity
 * phase carrying **no test of any kind** — no Jest suite named it, and no
 * Maestro flow drives a single one of its fifteen testIDs. Its store is pinned
 * separately in `../../__tests__/healthChallengesStorage.test.ts`; this suite
 * owns the screen.
 *
 * Renders the REAL screen through <ThemeProvider>, mocking only the
 * storage-backed async functions, so the cases below assert the actual payload
 * that would go on the wire rather than a stub of it.
 *
 * The invariants these cases exist to pin:
 *
 *  1. **`draftToWrite` is the only gate on the submit button**, and it is
 *     evaluated on every render. A challenge with a blank name, or a target of
 *     zero, must be unsendable — the server would take `target_grams: 0` and
 *     the member would own a challenge that is complete before it starts, and
 *     divides by zero on every progress bar.
 *  2. **`target_food_name` is carried ONLY for `custom_ingredient`.** Every
 *     other category matches on the category itself, so a stray ingredient name
 *     left in the draft after switching category away must not reach the wire —
 *     the server would narrow a "vegetables" challenge to one food.
 *  3. **Pause is not delete.** Toggling active moves a challenge to a visible
 *     PAUSED list and can be reversed; only the destructive Alert removes it.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createChallenge,
  deleteChallenge,
  loadChallengeProgressToday,
  loadChallenges,
  updateChallenge,
  type HealthFoodChallenge,
} from '../../healthChallengesStorage';
import { HealthChallengesScreen } from '../HealthChallengesScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

// This suite renders the screen standalone, with no real NavigationContainer,
// so the real `useFocusEffect` (used to re-hydrate on focus / HealthKit sync)
// has no navigator to attach to. Same stub the Goals suite uses.
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactActual = jest.requireActual('react');
    ReactActual.useEffect(() => callback(), [callback]);
  },
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

jest.mock('../../healthChallengesStorage', () => {
  const actual = jest.requireActual('../../healthChallengesStorage');
  return {
    ...actual,
    loadChallenges: jest.fn(),
    loadChallengeProgressToday: jest.fn(),
    createChallenge: jest.fn(),
    updateChallenge: jest.fn(),
    deleteChallenge: jest.fn(),
  };
});

const mockLoad = loadChallenges as jest.Mock;
const mockToday = loadChallengeProgressToday as jest.Mock;
const mockCreate = createChallenge as jest.Mock;
const mockUpdate = updateChallenge as jest.Mock;
const mockDelete = deleteChallenge as jest.Mock;

const ISO = '2026-07-13T08:00:00.000Z';

function challenge(over: Partial<HealthFoodChallenge> = {}): HealthFoodChallenge {
  return {
    id: 'fchal-1',
    user_id: 'user-1',
    name: 'Vegetables',
    category: 'vegetables',
    target_food_name: null,
    target_grams: 400,
    frequency: 'daily',
    is_active: true,
    icon: null,
    created_at: ISO,
    updated_at: ISO,
    deleted_at: null,
    ...over,
  };
}

type Rendered = ReactTestRenderer.ReactTestRenderer;

async function render(): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthChallengesScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function node(tree: Rendered, testID: string) {
  const found = tree.root.findAll((n) => n.props?.testID === testID);
  if (found.length === 0) throw new Error(`no element with testID ${testID}`);
  return found[0];
}

function maybe(tree: Rendered, testID: string) {
  return tree.root.findAll((n) => n.props?.testID === testID)[0];
}

async function press(tree: Rendered, testID: string) {
  await act(async () => node(tree, testID).props.onPress());
}

async function type(tree: Rendered, testID: string, text: string) {
  await act(async () => node(tree, testID).props.onChangeText(text));
}

/**
 * Concatenated text of the whole tree.
 *
 * Children of ONE element are joined with no separator, elements with a space:
 * `PAUSED ({paused.length})` arrives as `['PAUSED (', 2, ')']` and has to read
 * back as `PAUSED (2)`, not `PAUSED ( 2 )`.
 */
function textOf(tree: Rendered): string {
  return tree.root
    .findAll((n) => typeof n.type === 'string')
    .map((n) => {
      const c = n.props?.children;
      return (Array.isArray(c) ? c : [c])
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .map(String)
        .join('');
    })
    .filter((text) => text.length > 0)
    .join(' ');
}

/** Fill the form to a state `draftToWrite` accepts. */
async function fillValidDraft(tree: Rendered, name = 'Eat more veg', grams = '500') {
  await type(tree, 'health-challenge-name-input', name);
  await type(tree, 'health-challenge-grams-input', grams);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue([]);
  mockToday.mockResolvedValue(null);
  mockCreate.mockResolvedValue([]);
  mockUpdate.mockResolvedValue([]);
  mockDelete.mockResolvedValue([]);
});

/* ------------------------------------------------------------------ */
/* LOAD                                                                */
/* ------------------------------------------------------------------ */

describe('load', () => {
  it('hydrates the list and today’s progress on focus', async () => {
    await render();
    expect(mockLoad).toHaveBeenCalled();
    expect(mockToday).toHaveBeenCalled();
  });

  it('shows the empty state when there is no challenge at all', async () => {
    const tree = await render();
    expect(maybe(tree, 'health-challenges-empty')).toBeDefined();
    expect(textOf(tree)).toContain('No challenges yet');
  });

  it('renders an active challenge with its target and cadence', async () => {
    mockLoad.mockResolvedValue([challenge({ target_grams: 400, frequency: 'daily' })]);
    const tree = await render();

    expect(maybe(tree, 'health-challenge-fchal-1')).toBeDefined();
    expect(maybe(tree, 'health-challenges-empty')).toBeUndefined();
    const text = textOf(tree);
    expect(text).toContain('Vegetables');
    expect(text).toContain('400g');
    expect(text).toContain('per day');
  });

  it('renders a weekly challenge as "per week", not "per day"', async () => {
    mockLoad.mockResolvedValue([challenge({ frequency: 'weekly' })]);
    const tree = await render();
    expect(textOf(tree)).toContain('per week');
  });

  it("annotates a challenge with today's consumed grams when progress is known", async () => {
    mockLoad.mockResolvedValue([challenge()]);
    mockToday.mockResolvedValue({
      date: '2026-07-13',
      challenges: [{ ...challenge(), consumed_grams: 150.4, remaining_grams: 250, today_completed: false, matched_foods: [], progress_percentage: 0.376 }],
      completed_count: 0,
      total_count: 1,
    });
    const tree = await render();
    // Rounded — a fractional gram reading is noise on a summary row.
    expect(textOf(tree)).toContain('150g today');
  });

  it('omits the progress annotation entirely when today’s read returned nothing', async () => {
    mockLoad.mockResolvedValue([challenge()]);
    mockToday.mockResolvedValue(null);
    const tree = await render();
    expect(textOf(tree)).not.toContain('today');
  });

  it('separates paused challenges into their own counted section', async () => {
    mockLoad.mockResolvedValue([
      challenge({ id: 'on', name: 'Vegetables' }),
      challenge({ id: 'off1', name: 'Fish', is_active: false }),
      challenge({ id: 'off2', name: 'Nuts', is_active: false }),
    ]);
    const tree = await render();

    expect(textOf(tree)).toContain('PAUSED (2)');
    expect(maybe(tree, 'health-challenge-on')).toBeDefined();
    expect(maybe(tree, 'health-challenge-off1')).toBeDefined();
  });

  it('a list of ONLY paused challenges is not an empty list', async () => {
    // `active.length === 0 && paused.length === 0` is the empty gate — a member
    // who paused everything still owns challenges and must not be told
    // otherwise.
    mockLoad.mockResolvedValue([challenge({ is_active: false })]);
    const tree = await render();
    expect(maybe(tree, 'health-challenges-empty')).toBeUndefined();
    expect(textOf(tree)).toContain('PAUSED (1)');
  });
});

/* ------------------------------------------------------------------ */
/* FORM — open, validate, cancel                                       */
/* ------------------------------------------------------------------ */

describe('the form', () => {
  it('is closed until the Add button is pressed, and the button is gone once it opens', async () => {
    const tree = await render();
    expect(maybe(tree, 'health-challenge-form')).toBeUndefined();

    await press(tree, 'health-challenges-add');

    expect(maybe(tree, 'health-challenge-form')).toBeDefined();
    expect(maybe(tree, 'health-challenges-add')).toBeUndefined();
    expect(textOf(tree)).toContain('NEW CHALLENGE');
  });

  it('opens blank — a previous edit never leaks into a new challenge', async () => {
    mockLoad.mockResolvedValue([challenge({ name: 'Vegetables', target_grams: 400 })]);
    const tree = await render();

    await press(tree, 'health-challenge-open-fchal-1');
    expect(node(tree, 'health-challenge-name-input').props.value).toBe('Vegetables');

    await press(tree, 'health-challenge-form-cancel');
    await press(tree, 'health-challenges-add');

    expect(node(tree, 'health-challenge-name-input').props.value).toBe('');
    expect(node(tree, 'health-challenge-grams-input').props.value).toBe('');
    expect(textOf(tree)).toContain('NEW CHALLENGE');
  });

  it('refuses to submit a blank draft', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');

    expect(node(tree, 'health-challenge-form-submit').props.disabled).toBe(true);
    await press(tree, 'health-challenge-form-submit');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('refuses a name that is only whitespace', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree, '   ', '500');

    expect(node(tree, 'health-challenge-form-submit').props.disabled).toBe(true);
  });

  it('refuses a target of zero — a challenge complete before it starts', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree, 'Eat more veg', '0');

    expect(node(tree, 'health-challenge-form-submit').props.disabled).toBe(true);
  });

  it('refuses a target that is missing entirely', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await type(tree, 'health-challenge-name-input', 'Eat more veg');

    expect(node(tree, 'health-challenge-form-submit').props.disabled).toBe(true);
  });

  it('enables submit once name and a positive target are both present', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree);

    expect(node(tree, 'health-challenge-form-submit').props.disabled).toBe(false);
  });

  it('strips non-digits from the target field, so a typed unit cannot reach the payload', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await type(tree, 'health-challenge-grams-input', '5a0b0g');

    expect(node(tree, 'health-challenge-grams-input').props.value).toBe('500');
  });

  it('cancel closes the form and writes nothing', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree);
    await press(tree, 'health-challenge-form-cancel');

    expect(maybe(tree, 'health-challenge-form')).toBeUndefined();
    expect(maybe(tree, 'health-challenges-add')).toBeDefined();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* CATEGORY + FREQUENCY                                                */
/* ------------------------------------------------------------------ */

describe('category and frequency', () => {
  it('defaults to vegetables, daily', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');

    expect(node(tree, 'health-challenge-category-vegetables').props.accessibilityState.selected).toBe(true);
    expect(node(tree, 'health-challenge-frequency-daily').props.accessibilityState.selected).toBe(true);
  });

  it('selects one category at a time', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await press(tree, 'health-challenge-category-fish');

    expect(node(tree, 'health-challenge-category-fish').props.accessibilityState.selected).toBe(true);
    expect(node(tree, 'health-challenge-category-vegetables').props.accessibilityState.selected).toBe(false);
  });

  it('reveals the ingredient field ONLY for a custom-ingredient challenge', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    expect(maybe(tree, 'health-challenge-ingredient-input')).toBeUndefined();

    await press(tree, 'health-challenge-category-custom_ingredient');
    expect(maybe(tree, 'health-challenge-ingredient-input')).toBeDefined();

    await press(tree, 'health-challenge-category-nuts');
    expect(maybe(tree, 'health-challenge-ingredient-input')).toBeUndefined();
  });

  it('flips the cadence to weekly', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await press(tree, 'health-challenge-frequency-weekly');

    expect(node(tree, 'health-challenge-frequency-weekly').props.accessibilityState.selected).toBe(true);
    expect(node(tree, 'health-challenge-frequency-daily').props.accessibilityState.selected).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* CREATE                                                              */
/* ------------------------------------------------------------------ */

describe('create', () => {
  it('sends the exact payload, trimmed, and closes the form', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree, '  Eat more veg  ', '500');
    await press(tree, 'health-challenge-form-submit');

    expect(mockCreate).toHaveBeenCalledWith({
      name: 'Eat more veg',
      category: 'vegetables',
      target_food_name: null,
      target_grams: 500,
      frequency: 'daily',
      is_active: true,
    });
    expect(maybe(tree, 'health-challenge-form')).toBeUndefined();
  });

  it('carries target_food_name for a custom ingredient', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await press(tree, 'health-challenge-category-custom_ingredient');
    await type(tree, 'health-challenge-ingredient-input', '  Avocado  ');
    await fillValidDraft(tree, 'Avocado daily', '50');
    await press(tree, 'health-challenge-form-submit');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'custom_ingredient', target_food_name: 'Avocado' })
    );
  });

  it('DROPS an ingredient name once the category moves off custom_ingredient', async () => {
    // Otherwise the server would narrow a whole-category challenge to one food.
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await press(tree, 'health-challenge-category-custom_ingredient');
    await type(tree, 'health-challenge-ingredient-input', 'Avocado');
    await press(tree, 'health-challenge-category-vegetables');
    await fillValidDraft(tree, 'Eat more veg', '500');
    await press(tree, 'health-challenge-form-submit');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'vegetables', target_food_name: null })
    );
  });

  it('sends null rather than an empty string when the ingredient is left blank', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await press(tree, 'health-challenge-category-custom_ingredient');
    await fillValidDraft(tree, 'Something', '50');
    await press(tree, 'health-challenge-form-submit');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ target_food_name: null }));
  });

  it('re-reads today’s progress after a create, so the new row is annotated', async () => {
    const tree = await render();
    mockToday.mockClear();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree);
    await press(tree, 'health-challenge-form-submit');

    expect(mockToday).toHaveBeenCalled();
  });

  it('shows the challenge the writer returned, without a second list read', async () => {
    mockCreate.mockResolvedValue([challenge({ id: 'new', name: 'Eat more veg' })]);
    const tree = await render();
    mockLoad.mockClear();

    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree);
    await press(tree, 'health-challenge-form-submit');

    expect(maybe(tree, 'health-challenge-new')).toBeDefined();
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('re-opens the form for the next challenge rather than staying open', async () => {
    const tree = await render();
    await press(tree, 'health-challenges-add');
    await fillValidDraft(tree);
    await press(tree, 'health-challenge-form-submit');

    expect(maybe(tree, 'health-challenges-add')).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* EDIT                                                                */
/* ------------------------------------------------------------------ */

describe('edit', () => {
  it('prefills every field from the challenge and labels the action Save', async () => {
    mockLoad.mockResolvedValue([
      challenge({
        name: 'Fish twice a week',
        category: 'fish',
        target_grams: 300,
        frequency: 'weekly',
      }),
    ]);
    const tree = await render();
    await press(tree, 'health-challenge-open-fchal-1');

    expect(textOf(tree)).toContain('EDIT CHALLENGE');
    expect(node(tree, 'health-challenge-name-input').props.value).toBe('Fish twice a week');
    expect(node(tree, 'health-challenge-grams-input').props.value).toBe('300');
    expect(node(tree, 'health-challenge-category-fish').props.accessibilityState.selected).toBe(true);
    expect(node(tree, 'health-challenge-frequency-weekly').props.accessibilityState.selected).toBe(true);
    expect(textOf(tree)).toContain('Save');
  });

  it('prefills the ingredient name for a custom-ingredient challenge', async () => {
    mockLoad.mockResolvedValue([
      challenge({ category: 'custom_ingredient', target_food_name: 'Avocado' }),
    ]);
    const tree = await render();
    await press(tree, 'health-challenge-open-fchal-1');

    expect(node(tree, 'health-challenge-ingredient-input').props.value).toBe('Avocado');
  });

  it('updates against the id, and does not create a second challenge', async () => {
    mockLoad.mockResolvedValue([challenge()]);
    const tree = await render();

    await press(tree, 'health-challenge-open-fchal-1');
    await type(tree, 'health-challenge-grams-input', '600');
    await press(tree, 'health-challenge-form-submit');

    expect(mockUpdate).toHaveBeenCalledWith(
      'fchal-1',
      expect.objectContaining({ target_grams: 600 })
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* PAUSE / RESUME                                                      */
/* ------------------------------------------------------------------ */

describe('pause and resume', () => {
  it('pausing an active challenge patches ONLY is_active', async () => {
    mockLoad.mockResolvedValue([challenge({ is_active: true })]);
    const tree = await render();

    await press(tree, 'health-challenge-toggle-fchal-1');

    expect(mockUpdate).toHaveBeenCalledWith('fchal-1', { is_active: false });
  });

  it('resuming a paused challenge flips it back', async () => {
    mockLoad.mockResolvedValue([challenge({ is_active: false })]);
    const tree = await render();

    await press(tree, 'health-challenge-toggle-fchal-1');

    expect(mockUpdate).toHaveBeenCalledWith('fchal-1', { is_active: true });
  });

  it('labels the control for the action it performs, not the current state', async () => {
    mockLoad.mockResolvedValue([challenge({ is_active: true })]);
    const tree = await render();
    expect(node(tree, 'health-challenge-toggle-fchal-1').props.accessibilityLabel).toBe(
      'Pause challenge'
    );
  });

  it('moves the challenge into the PAUSED section using the writer’s return value', async () => {
    mockLoad.mockResolvedValue([challenge({ is_active: true })]);
    mockUpdate.mockResolvedValue([challenge({ is_active: false })]);
    const tree = await render();

    await press(tree, 'health-challenge-toggle-fchal-1');

    expect(textOf(tree)).toContain('PAUSED (1)');
  });
});

/* ------------------------------------------------------------------ */
/* DELETE                                                              */
/* ------------------------------------------------------------------ */

describe('delete', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('asks first, naming the challenge, and writes nothing on its own', async () => {
    mockLoad.mockResolvedValue([challenge({ name: 'Vegetables' })]);
    const tree = await render();

    await press(tree, 'health-challenge-delete-fchal-1');

    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][1]).toContain('Vegetables');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('offers a cancel that is not destructive, and a destructive Delete', async () => {
    mockLoad.mockResolvedValue([challenge()]);
    const tree = await render();
    await press(tree, 'health-challenge-delete-fchal-1');

    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; style?: string }>;
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    expect(buttons[0].style).toBe('cancel');
    expect(buttons[1].style).toBe('destructive');
  });

  it('deletes only once the destructive action is taken', async () => {
    mockLoad.mockResolvedValue([challenge()]);
    const tree = await render();
    await press(tree, 'health-challenge-delete-fchal-1');

    const buttons = alertSpy.mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });

    expect(mockDelete).toHaveBeenCalledWith('fchal-1');
  });

  it('closes the open EDIT form when the challenge being edited is deleted', async () => {
    // Otherwise the form would sit there editing a row that no longer exists,
    // and Save would resurrect it.
    mockLoad.mockResolvedValue([challenge()]);
    const tree = await render();

    await press(tree, 'health-challenge-open-fchal-1');
    expect(maybe(tree, 'health-challenge-form')).toBeDefined();

    await press(tree, 'health-challenge-delete-fchal-1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });

    expect(maybe(tree, 'health-challenge-form')).toBeUndefined();
  });

  it('leaves an unrelated open form alone when a DIFFERENT challenge is deleted', async () => {
    mockLoad.mockResolvedValue([challenge({ id: 'a' }), challenge({ id: 'b', name: 'Fish' })]);
    mockDelete.mockResolvedValue([challenge({ id: 'a' })]);
    const tree = await render();

    await press(tree, 'health-challenge-open-a');
    await press(tree, 'health-challenge-delete-b');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ onPress?: () => void }>;
    await act(async () => {
      buttons[1].onPress?.();
    });

    expect(maybe(tree, 'health-challenge-form')).toBeDefined();
  });
});
