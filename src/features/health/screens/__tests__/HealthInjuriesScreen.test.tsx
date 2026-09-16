/**
 * Symply Health INJURY LOG tab — log, edit, resolve, reopen, delete.
 *
 * Renders the REAL screen through <ThemeProvider> and drives the primary paths.
 * Only the storage-backed async functions are mocked; the pure helpers stay real
 * (they own their coverage in ../../__tests__/healthInjuryStorage.test.ts),
 * which is what lets these cases assert the actual `body_part` string that would
 * go on the wire rather than a stub of it.
 *
 * The invariants these cases exist to pin:
 *
 *  1. **The area picker is the only way to name a body part**, so the screen
 *     cannot emit a wording the deployed gate will not recognise. Saving a
 *     "Left Knee" must produce exactly `body_part: 'Left Knee'`.
 *  2. **Resolve is not delete.** A resolved injury moves to a visible RESOLVED
 *     list and can be reopened — it does not vanish (the donor's behaviour, and
 *     the reason the backend keeps the row).
 *  3. **The screen never diagnoses, grades or advises treatment.** A separate
 *     case greps the rendered tree for the donor's clinical copy.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addInjury,
  deleteInjury,
  editInjury,
  loadInjuries,
  reactivateInjury,
  resolveInjury,
  type Injury,
} from '../../healthInjuryStorage';
import { HealthInjuriesScreen } from '../HealthInjuriesScreen';

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

jest.mock('../../healthInjuryStorage', () => {
  const actual = jest.requireActual('../../healthInjuryStorage');
  return {
    ...actual,
    loadInjuries: jest.fn(),
    addInjury: jest.fn(),
    editInjury: jest.fn(),
    resolveInjury: jest.fn(),
    reactivateInjury: jest.fn(),
    deleteInjury: jest.fn(),
  };
});

const mockLoad = loadInjuries as jest.Mock;
const mockAdd = addInjury as jest.Mock;
const mockEdit = editInjury as jest.Mock;
const mockResolve = resolveInjury as jest.Mock;
const mockReactivate = reactivateInjury as jest.Mock;
const mockDelete = deleteInjury as jest.Mock;

function injury(over: Partial<Injury> = {}): Injury {
  return {
    id: over.id ?? 'inj_1',
    date: over.date ?? '2026-07-13',
    bodyPart: over.bodyPart ?? 'Left Knee',
    painLevel: over.painLevel ?? 2,
    injuryType: over.injuryType ?? 'strain',
    cause: over.cause ?? 'workout',
    notes: over.notes ?? '',
    isActive: over.isActive ?? true,
    createdAt: over.createdAt ?? '2026-07-13T08:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
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

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

/** The shape every mocked writer resolves with. */
function writeResult(injuries: Injury[], message: string | null = null) {
  return { injuries, status: 'saved' as const, message };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue([]);
  mockAdd.mockImplementation(async () => writeResult([injury()]));
  mockEdit.mockImplementation(async () => writeResult([injury()]));
  mockResolve.mockImplementation(async () => writeResult([injury({ isActive: false })]));
  mockReactivate.mockImplementation(async () => writeResult([injury()]));
  mockDelete.mockImplementation(async () => writeResult([]));
});

/* ------------------------------------------------------------------ */
/* Shell + empty state                                                 */
/* ------------------------------------------------------------------ */

describe('HealthInjuriesScreen', () => {
  it('HEALTH-INJUI-001: renders the shell and an honest empty state', async () => {
    const tree = await render(<HealthInjuriesScreen />);

    expect(byTestId(tree, 'health-injuries-screen').length).toBe(1);
    expect(byTestId(tree, 'health-injuries-screen-scroll-end').length).toBe(1);
    expect(byTestId(tree, 'health-injuries-active-empty').length).toBe(1);
    expect(allText(byTestId(tree, 'health-injuries-counts')[0])).toBe('0 active · 0 resolved');
    // Nothing is gating, and the screen says so rather than implying it might be.
    expect(allText(byTestId(tree, 'health-injuries-gate-note')[0])).toContain(
      'Nothing here is changing your exercise suggestions'
    );
    // No RESOLVED card until there is something in it.
    expect(byTestId(tree, 'health-injuries-resolved-card').length).toBe(0);
  });

  it('HEALTH-INJUI-002: the counts and the gate note read off the log', async () => {
    mockLoad.mockResolvedValue([
      injury({ id: 'a', bodyPart: 'Left Knee' }),
      injury({ id: 'b', bodyPart: 'Lower Back' }),
      injury({ id: 'c', bodyPart: 'Left Knee', isActive: false }),
    ]);
    const tree = await render(<HealthInjuriesScreen />);

    expect(allText(byTestId(tree, 'health-injuries-counts')[0])).toBe('2 active · 1 resolved');
    const note = allText(byTestId(tree, 'health-injuries-gate-note')[0]);
    expect(note).toContain('your left knee and lower back');
    expect(note).toContain('Workouts library');
  });

  it('HEALTH-INJUI-003: a row shows what was logged, in the user’s own words', async () => {
    mockLoad.mockResolvedValue([
      injury({ id: 'inj_9', bodyPart: 'Left Knee', injuryType: 'strain', painLevel: 3, notes: 'stairs' }),
    ]);
    const tree = await render(<HealthInjuriesScreen />);

    expect(byTestId(tree, 'health-injury-row-inj_9').length).toBe(1);
    const meta = allText(byTestId(tree, 'health-injury-meta-inj_9')[0]);
    expect(meta).toContain('Strain');
    expect(meta).toContain('Severe');
    expect(meta).toContain('logged');
    expect(allText(byTestId(tree, 'health-injury-notes-inj_9')[0])).toBe('stairs');
  });
});

/* ------------------------------------------------------------------ */
/* Logging — the vocabulary choke point                                */
/* ------------------------------------------------------------------ */

describe('HealthInjuriesScreen — logging', () => {
  it('HEALTH-INJUI-004: the form opens with the donor’s field order and defaults', async () => {
    const tree = await render(<HealthInjuriesScreen />);
    expect(byTestId(tree, 'health-injuries-form').length).toBe(0);

    await press(tree, 'health-injuries-add');

    expect(byTestId(tree, 'health-injuries-form').length).toBe(1);
    const text = allText(tree.toJSON());
    for (const label of ['Affected area', 'Pain level', 'Type of discomfort', 'Cause', 'Date', 'Notes']) {
      expect(text).toContain(label);
    }
    // Donor defaults: Mild pain, type Pain, cause Workout, and today's date.
    expect(byTestId(tree, 'health-injury-pain-1')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'health-injury-type-pain')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestId(tree, 'health-injury-cause-workout')[0].props.accessibilityState.selected).toBe(
      true
    );
    expect(input(tree, 'health-injury-date-input').props.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('HEALTH-INJUI-005: saving sends the GATE vocabulary, not a typed string', async () => {
    // The screen's single most important behaviour. `body_part` is resolved from
    // the picker id by the real `validateInjuryDraft`, so this asserts the exact
    // string the Worker would fold to `knee`.
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-leftKnee');
    await press(tree, 'health-injury-pain-3');
    await press(tree, 'health-injury-type-strain');
    await type(tree, 'health-injury-date-input', '2026-07-13');
    await type(tree, 'health-injury-notes-input', '  twinge on stairs  ');
    await press(tree, 'health-injury-save');

    expect(mockAdd).toHaveBeenCalledWith({
      date: '2026-07-13',
      body_part: 'Left Knee',
      pain_level: 3,
      injury_type: 'strain',
      cause: 'workout',
      notes: 'twinge on stairs',
    });
    // A successful save closes the form.
    expect(byTestId(tree, 'health-injuries-form').length).toBe(0);
  });

  it('HEALTH-INJUI-006: there is no free-text body-part field on the screen', async () => {
    // A structural guard: the whole gate contract rests on the picker being the
    // only source of `body_part`. A text input added here later would let a
    // typo silently disable the safety surface.
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');

    const inputs = tree.root
      .findAll((n) => (n.type as unknown as string) === 'TextInput')
      .map((n) => n.props.testID);
    expect(inputs.sort()).toEqual(['health-injury-date-input', 'health-injury-notes-input']);
  });

  it('HEALTH-INJUI-007: saving with no area re-asks instead of guessing', async () => {
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-save');

    expect(mockAdd).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-injuries-message')[0])).toBe('Choose the area first.');
    // The form stays open with the user's input intact.
    expect(byTestId(tree, 'health-injuries-form').length).toBe(1);
  });

  it('HEALTH-INJUI-008: a bad date is refused in plain words, never a validator string', async () => {
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-neck');
    await type(tree, 'health-injury-date-input', '2026-02-30');
    await press(tree, 'health-injury-save');

    expect(mockAdd).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-injuries-message')[0])).toBe(
      'Enter the date as YYYY-MM-DD.'
    );
  });

  it('HEALTH-INJUI-009: a part the gate cannot act on says so before you save', async () => {
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');

    await press(tree, 'health-injury-part-leftKnee');
    expect(byTestId(tree, 'health-injury-part-no-gate').length).toBe(0);

    await press(tree, 'health-injury-part-head');
    const note = allText(byTestId(tree, 'health-injury-part-no-gate')[0]);
    expect(note).toContain('Head');
    expect(note).toContain('your suggestions will not change');
    // It is still recordable — the app does not refuse to log it.
    await press(tree, 'health-injury-save');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ body_part: 'Head' }));
  });

  it('HEALTH-INJUI-010: a REJECTED save keeps the form open with the input intact', async () => {
    mockAdd.mockResolvedValue({
      injuries: [],
      status: 'rejected',
      message: 'That could not be saved. Please try again.',
    });
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-leftKnee');
    await press(tree, 'health-injury-save');

    expect(byTestId(tree, 'health-injuries-form').length).toBe(1);
    expect(byTestId(tree, 'health-injury-part-leftKnee')[0].props.accessibilityState.selected).toBe(
      true
    );
    expect(allText(byTestId(tree, 'health-injuries-message')[0])).toBe(
      'That could not be saved. Please try again.'
    );
  });

  it('HEALTH-INJUI-011: an offline save is kept and announced', async () => {
    mockAdd.mockResolvedValue({
      injuries: [injury()],
      status: 'offline',
      message: 'Saved on this device — it will sync when you are back online.',
    });
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-leftKnee');
    await press(tree, 'health-injury-save');

    expect(byTestId(tree, 'health-injuries-form').length).toBe(0);
    expect(allText(byTestId(tree, 'health-injuries-message')[0])).toContain('sync when you are');
    expect(byTestId(tree, 'health-injury-row-inj_1').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Edit / resolve / reopen / delete                                    */
/* ------------------------------------------------------------------ */

describe('HealthInjuriesScreen — editing and lifecycle', () => {
  it('HEALTH-INJUI-012: edit reopens the row in the form and PUTs the change', async () => {
    mockLoad.mockResolvedValue([
      injury({ id: 'inj_9', bodyPart: 'Lower Back', painLevel: 2, injuryType: 'strain' }),
    ]);
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injury-edit-inj_9');

    // Seeded from the row, not blank.
    expect(byTestId(tree, 'health-injury-part-lowerBack')[0].props.accessibilityState.selected).toBe(
      true
    );
    expect(byTestId(tree, 'health-injury-pain-2')[0].props.accessibilityState.selected).toBe(true);

    await press(tree, 'health-injury-pain-4');
    await press(tree, 'health-injury-save');

    expect(mockEdit).toHaveBeenCalledWith(
      'inj_9',
      expect.objectContaining({ body_part: 'Lower Back', pain_level: 4 })
    );
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('HEALTH-INJUI-013: resolve is not delete — the row moves to RESOLVED', async () => {
    mockLoad.mockResolvedValue([injury({ id: 'inj_9' })]);
    mockResolve.mockResolvedValue(writeResult([injury({ id: 'inj_9', isActive: false })]));
    const tree = await render(<HealthInjuriesScreen />);

    expect(byTestId(tree, 'health-injuries-resolved-card').length).toBe(0);
    await press(tree, 'health-injury-resolve-inj_9');

    expect(mockResolve).toHaveBeenCalledWith('inj_9');
    expect(mockDelete).not.toHaveBeenCalled();
    // Still on screen, in the history card, and reopenable.
    expect(byTestId(tree, 'health-injuries-resolved-card').length).toBe(1);
    expect(byTestId(tree, 'health-injury-row-inj_9').length).toBe(1);
    expect(byTestId(tree, 'health-injury-reopen-inj_9').length).toBe(1);
    expect(byTestId(tree, 'health-injuries-active-empty').length).toBe(1);
    expect(allText(byTestId(tree, 'health-injuries-counts')[0])).toBe('0 active · 1 resolved');
  });

  it('HEALTH-INJUI-014: a resolved injury can be reopened when it flares up', async () => {
    // The donor cannot do this at all — healed rows are filtered out of every
    // list and become unreachable. The route allows `is_active: true` on PUT.
    mockLoad.mockResolvedValue([injury({ id: 'inj_9', isActive: false })]);
    mockReactivate.mockResolvedValue(writeResult([injury({ id: 'inj_9' })]));
    const tree = await render(<HealthInjuriesScreen />);

    await press(tree, 'health-injury-reopen-inj_9');

    expect(mockReactivate).toHaveBeenCalledWith('inj_9');
    expect(byTestId(tree, 'health-injury-resolve-inj_9').length).toBe(1);
    expect(allText(byTestId(tree, 'health-injuries-counts')[0])).toBe('1 active · 0 resolved');
  });

  it('HEALTH-INJUI-015: delete takes two taps and says so in between', async () => {
    mockLoad.mockResolvedValue([injury({ id: 'inj_9' })]);
    const tree = await render(<HealthInjuriesScreen />);

    await press(tree, 'health-injury-delete-inj_9');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-injury-delete-inj_9')[0])).toContain(
      'Tap again to delete'
    );

    await press(tree, 'health-injury-delete-inj_9');
    expect(mockDelete).toHaveBeenCalledWith('inj_9');
    expect(byTestId(tree, 'health-injury-row-inj_9').length).toBe(0);
  });

  it('HEALTH-INJUI-016: every row verb is labelled for VoiceOver, not icon-only', async () => {
    mockLoad.mockResolvedValue([injury({ id: 'inj_9', bodyPart: 'Left Knee' })]);
    const tree = await render(<HealthInjuriesScreen />);

    const labels = ['edit', 'resolve', 'delete'].map(
      (verb) =>
        tree.root.find(
          (n) => n.props?.testID === `health-injury-${verb}-inj_9` && n.props?.accessibilityLabel
        ).props.accessibilityLabel
    );
    expect(labels).toEqual([
      'Edit Left Knee entry',
      'Mark Left Knee entry resolved',
      'Delete Left Knee entry',
    ]);
    // …and each carries a visible caption beside its glyph.
    for (const [verb, caption] of [
      ['edit', 'Edit'],
      ['resolve', 'Mark resolved'],
      ['delete', 'Delete'],
    ] as const) {
      expect(allText(byTestId(tree, `health-injury-${verb}-inj_9`)[0])).toContain(caption);
    }
  });

  it('HEALTH-INJUI-018: a RESOLVED row is fully editable and deletable, not read-only history', async () => {
    // The whole reason resolve is not delete is that the row stays usable. Its
    // Edit and Delete controls live in a second, separately-rendered card, and
    // neither had ever been driven — a resolved row could have been inert and
    // the suite would not have noticed.
    mockLoad.mockResolvedValue([
      injury({ id: 'inj_9', isActive: false, bodyPart: 'Lower Back', painLevel: 3 }),
    ]);
    const tree = await render(<HealthInjuriesScreen />);

    // Edit reopens the healed row in the form, seeded from ITS values.
    await press(tree, 'health-injury-edit-inj_9');
    expect(
      byTestId(tree, 'health-injury-part-lowerBack')[0].props.accessibilityState.selected
    ).toBe(true);
    expect(byTestId(tree, 'health-injury-pain-3')[0].props.accessibilityState.selected).toBe(true);

    // Delete still takes two taps — history is not cheaper to destroy.
    await press(tree, 'health-injury-delete-inj_9');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(allText(byTestId(tree, 'health-injury-delete-inj_9')[0])).toContain(
      'Tap again to delete'
    );

    await press(tree, 'health-injury-delete-inj_9');
    expect(mockDelete).toHaveBeenCalledWith('inj_9');
  });

  it('HEALTH-INJUI-019: a chosen cause can be un-chosen, and reaches the payload either way', async () => {
    // Cause is the one optional field with no "none" chip — tapping the
    // selected one again IS the clear. Without that, a mis-tap is permanent for
    // the life of the form.
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-leftKnee');

    await press(tree, 'health-injury-cause-sportActivity');
    expect(
      byTestId(tree, 'health-injury-cause-sportActivity')[0].props.accessibilityState.selected
    ).toBe(true);

    await press(tree, 'health-injury-cause-sportActivity');
    expect(
      byTestId(tree, 'health-injury-cause-sportActivity')[0].props.accessibilityState.selected
    ).toBe(false);

    await press(tree, 'health-injury-save');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ cause: null }));
  });

  it('HEALTH-INJUI-020: the Save button is disabled while the write is in flight', async () => {
    // Two taps would POST the injury twice, and a duplicate gating row is not
    // cosmetic — it suppresses exercises the user did not ask to suppress.
    let release!: () => void;
    mockAdd.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(writeResult([injury()]));
        })
    );

    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    await press(tree, 'health-injury-part-leftKnee');

    const saveButton = () =>
      tree.root.find(
        (n) => n.props?.testID === 'health-injury-save' && typeof n.props?.onPress === 'function'
      );
    expect(saveButton().props.disabled).toBe(false);

    act(() => {
      void saveButton().props.onPress();
    });
    expect(saveButton().props.disabled).toBe(true);
    expect(saveButton().props.accessibilityState).toEqual({ disabled: true });

    await act(async () => {
      release();
    });
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Safety-surface copy                                                 */
/* ------------------------------------------------------------------ */

describe('HealthInjuriesScreen — medical stance', () => {
  it('HEALTH-INJUI-017: the screen never diagnoses, grades or advises treatment', async () => {
    mockLoad.mockResolvedValue([
      injury({ id: 'a', bodyPart: 'Left Knee', painLevel: 4, injuryType: 'sprain' }),
      injury({ id: 'b', bodyPart: 'Lower Back', isActive: false }),
    ]);
    const tree = await render(<HealthInjuriesScreen />);
    await press(tree, 'health-injuries-add');
    const text = allText(tree.toJSON());

    // The donor's "Recovery Tips" card and its treatment advice.
    for (const advice of [
      'Professional recommendations',
      'Consult a professional',
      'Rest, Ice, Compression',
      'RICE',
      'Rest affected areas',
      'requiring attention',
      'see a doctor',
    ]) {
      expect(text).not.toContain(advice);
    }
    // The donor's per-level interpretations.
    for (const interpretation of [
      'may limit some activities',
      'limits most activities',
      'unable to perform activities',
      "doesn't affect activity",
    ]) {
      expect(text).not.toContain(interpretation);
    }
    // The donor's quasi-diagnostic type descriptions.
    for (const diagnosis of ['Ligament injury', 'Muscle or tendon injury', 'Inflammation']) {
      expect(text).not.toContain(diagnosis);
    }
    // And no clinical structure names to self-tag with.
    for (const anatomy of ['ACL', 'MCL', 'Meniscus', 'Plantar Fascia', 'Erector Spinae']) {
      expect(text).not.toContain(anatomy);
    }

    // What it DOES say: the bare self-reported level, and the mechanical effect.
    expect(text).toContain('Severe');
    expect(text).toContain('Workouts library');
  });
});
