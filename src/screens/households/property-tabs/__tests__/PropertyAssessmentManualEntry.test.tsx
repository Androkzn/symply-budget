/**
 * Manual assessment entry — the only way to record an assessment when the AI
 * cannot read the notice.
 *
 * Extraction is disabled outright in House private mode
 * (`localUtilitiesApi.uploadAndExtractAssessment` throws), and the copy the
 * member sees there promises "enter the year and the assessed value yourself".
 * Until this path existed the promise was false: the review sheet was reachable
 * ONLY after a successful extraction, so a private-mode owner could not save an
 * assessment at all — the local write path (`createBCAssessment`) worked and was
 * simply unreachable. These tests pin the affordance, the validation and the
 * year-over-year derivation that makes the saved row useful.
 */

// The sheet is a Modal in the real app; render its body inline so the fields
// under test are in the tree.
// Keeps the sheet's header — the review sheet's Save now lives there rather
// than in its body, so a children-only stub would hide the control these
// tests press. The `mock` name prefix is what lets a hoisted `jest.mock`
// factory reference an import at all.
jest.mock('@components/ui/BottomSheet', () => mockCreateBottomSheet());

jest.mock('react-native-gifted-charts', () => ({
  BarChart: () => null,
  LineChart: () => null,
  PieChart: () => null,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@components/cloud-storage', () => ({ CloudFilePicker: () => null }));

jest.mock('../documentPicker', () => ({
  pickPropertyDocument: jest.fn(async () => null),
  PROPERTY_DOCUMENT_MIME_TYPES: ['application/pdf'],
}));

jest.mock('@services/toastManager', () => ({ showToast: jest.fn() }));

jest.mock('@api/households', () => ({ householdsApi: { update: jest.fn() } }));

const mockGetAssessments = jest.fn();
const mockCreateAssessment = jest.fn();
const mockUpdateAssessment = jest.fn();
const mockUploadAndExtract = jest.fn();
jest.mock('@features/utilities/api/utilities', () => ({
  utilitiesApi: {
    getBCAssessments: (...a: unknown[]) => mockGetAssessments(...a),
    createBCAssessment: (...a: unknown[]) => mockCreateAssessment(...a),
    updateBCAssessment: (...a: unknown[]) => mockUpdateAssessment(...a),
    uploadAndExtractAssessment: (...a: unknown[]) => mockUploadAndExtract(...a),
  },
}));

// The property's address decides the jurisdiction — never the user's locale —
// so the store is the only input the labels under test depend on.
const mockHouseholdState: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      households: mockHouseholdState.current ? [mockHouseholdState.current] : [],
      currentHousehold: mockHouseholdState.current,
      updateHousehold: jest.fn(),
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import type { BCAssessmentData } from '@features/utilities/api/utilities';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { createBottomSheetMock as mockCreateBottomSheet } from '../../../../test-utils/mockBottomSheet';
import { PropertyAssessmentTab } from '../PropertyAssessmentTab';

let tree: ReactTestRenderer.ReactTestRenderer;

/** The year the manual sheet defaults to, computed the same way the tab does. */
const THIS_YEAR = new Date().getFullYear();

function makeRow(
  over: Partial<BCAssessmentData> &
    Pick<BCAssessmentData, 'id' | 'assessment_year' | 'assessed_value'>
): BCAssessmentData {
  return {
    household_id: 'hh-1',
    property_class: null,
    land_value: null,
    improvement_value: null,
    previous_year_value: null,
    change_percent: null,
    assessment_pdf_key: null,
    appeal_deadline: null,
    appeal_filed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderTab(rows: BCAssessmentData[] = []) {
  mockGetAssessments.mockResolvedValue(rows);
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PropertyAssessmentTab householdId="hh-1" onChanged={jest.fn()} />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

/** The outermost node carrying this testID and a handler of the given name. */
function handlerNode(testID: string, handler: 'onPress' | 'onChangeText') {
  const nodes = tree.root.findAll(
    (n) => n.props?.testID === testID && typeof n.props?.[handler] === 'function',
    { deep: true }
  );
  if (!nodes.length) throw new Error(`no node with testID "${testID}" and ${handler}`);
  return nodes[0];
}

async function press(testID: string) {
  const node = handlerNode(testID, 'onPress');
  await act(async () => {
    await node.props.onPress();
  });
  await flush();
}

async function type(testID: string, text: string) {
  const node = handlerNode(testID, 'onChangeText');
  await act(async () => {
    node.props.onChangeText(text);
  });
}

function valueOf(testID: string): string {
  return handlerNode(testID, 'onChangeText').props.value as string;
}

function flatText(json: unknown): string {
  if (json == null || json === false) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(flatText).join(' ');
  return flatText((json as { children?: unknown }).children);
}

/**
 * The whole screen as one string with whitespace collapsed — the only way to
 * assert on interpolated copy like `{valueLabel} · total`, which arrives as
 * separate text nodes and so never appears in `collectRenderedText`.
 */
function screenText(): string {
  return flatText(tree.toJSON()).replace(/\s+/g, ' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateAssessment.mockResolvedValue({});
  mockUpdateAssessment.mockResolvedValue({});
  mockHouseholdState.current = {
    id: 'hh-1',
    country: 'CA',
    state_province: 'BC',
    purchase_price: null,
    purchase_date: null,
  };
});

afterEach(async () => {
  await act(async () => {
    try {
      tree?.unmount();
    } catch {
      /* already unmounted */
    }
  });
});

describe('the manual-entry affordance', () => {
  // The dead end this whole file exists for: with no assessments saved and no
  // extraction available, the empty state was a wall.
  it('renders with no assessments saved', async () => {
    await renderTab([]);
    expect(collectRenderedText(tree)).toContain('Enter manually');
    expect(handlerNode('property-assessment-add-manual', 'onPress')).toBeTruthy();
  });

  // Adding the SECOND year is what makes the value-history chart and the YoY
  // row appear, so the affordance has to survive the populated state too — it
  // must not be buried inside the empty-state card.
  it('renders alongside assessments that already exist', async () => {
    await renderTab([makeRow({ id: 'a-1', assessment_year: THIS_YEAR - 2, assessed_value: 100_000_000 })]);
    expect(collectRenderedText(tree)).toContain('Enter manually');
    expect(handlerNode('property-assessment-add-manual', 'onPress')).toBeTruthy();
  });

  // Defaulting to the current year is the whole point of a one-tap affordance:
  // the owner is almost always entering the notice that just arrived. "Add",
  // not "Update", proves no existing row has been latched onto.
  it('opens the sheet on the current year as a new record', async () => {
    await renderTab([makeRow({ id: 'a-1', assessment_year: THIS_YEAR - 2, assessed_value: 100_000_000 })]);
    await press('property-assessment-add-manual');

    expect(valueOf('property-assessment-review-year')).toBe(String(THIS_YEAR));
    expect(valueOf('property-assessment-review-assessed')).toBe('');
    const text = collectRenderedText(tree);
    expect(text).toContain('Add assessment');
    expect(text).not.toContain(`Update ${THIS_YEAR} assessment`);
  });
});

describe('validation', () => {
  // A row with a zero assessed value poisons everything downstream — the YoY
  // percentage divides by it, and the land/building pie renders as nothing.
  it('blocks the save when the assessed value is blank', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');
    await press('property-assessment-review-save');

    expect(mockCreateAssessment).not.toHaveBeenCalled();
    // The sheet stays open with the reason on it, rather than closing silently.
    expect(screenText()).toContain('has to be more than zero');
  });

  it('blocks the save when the assessed value is zero', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-assessed', '0');
    await press('property-assessment-review-save');

    expect(mockCreateAssessment).not.toHaveBeenCalled();
  });

  // A half-typed year ("20") would otherwise be saved as the year 20 — the
  // field is free text, and the backend takes whatever integer it is handed.
  it('blocks the save on a year that is not a real assessment year', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-year', '20');
    await type('property-assessment-review-assessed', '1180000');
    await press('property-assessment-review-save');

    expect(mockCreateAssessment).not.toHaveBeenCalled();
    expect(screenText()).toContain('four-digit assessment year');
  });

  // Real notices round the land and building figures against each other, so a
  // disagreement with the total is worth saying out loud but never worth
  // refusing — the owner cannot change what their notice says.
  it('warns when land + buildings exceed the total but still saves', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-assessed', '1000000');
    await type('property-assessment-review-land', '900000');
    await type('property-assessment-review-improvement', '400000');

    expect(screenText()).toContain('add up to more than the total');

    await press('property-assessment-review-save');
    expect(mockCreateAssessment).toHaveBeenCalledTimes(1);
  });
});

describe('duplicate years', () => {
  // bc_assessment_data is UNIQUE on (household_id, assessment_year): a create
  // for a year already stored fails at the database. Detecting it in the client
  // turns a dead-end error into the edit the owner actually wanted.
  it('switches to editing the stored row when that year is typed', async () => {
    await renderTab([
      makeRow({
        id: 'a-2024',
        assessment_year: THIS_YEAR - 2,
        assessed_value: 100_000_000,
        appeal_deadline: `${THIS_YEAR - 2}-01-31`,
      }),
    ]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-year', String(THIS_YEAR - 2));

    // The sheet says so, rather than silently changing what Save will do.
    const text = collectRenderedText(tree);
    expect(text).toContain(`Update ${THIS_YEAR - 2} assessment`);
    // The stored figure is loaded in so the owner edits it rather than retypes it.
    expect(valueOf('property-assessment-review-assessed')).toBe('1000000');

    await press('property-assessment-review-save');
    expect(mockCreateAssessment).not.toHaveBeenCalled();
    expect(mockUpdateAssessment).toHaveBeenCalledWith('hh-1', 'a-2024', expect.anything());
  });
});

describe('year-over-year derivation', () => {
  // A manual entry has no extracted history behind it, so unless the preceding
  // stored year is folded in on save the chart stays flat and the "+X% YoY" row
  // never appears — the two things the assessment tab exists to show.
  it('derives previousYearValue and changePercent from the preceding stored year', async () => {
    await renderTab([
      makeRow({ id: 'a-prev', assessment_year: THIS_YEAR - 1, assessed_value: 100_000_000 }),
    ]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-assessed', '1100000');
    await press('property-assessment-review-save');

    expect(mockCreateAssessment).toHaveBeenCalledTimes(1);
    const payload = mockCreateAssessment.mock.calls[0][1];
    expect(payload).toMatchObject({
      assessmentYear: THIS_YEAR,
      assessedValue: 110_000_000,
      previousYearValue: 100_000_000,
      changePercent: 10,
    });
  });

  // Ontario is still valuing at January 1, 2016 and Saskatchewan at 2023, so an
  // unchanged assessment is the CORRECT reading for millions of owners. A `||`
  // default would drop that 0 and render the row as "no data", which reads as a
  // bug in the app rather than a freeze in the province.
  it('keeps a genuine 0% change as 0 instead of dropping it', async () => {
    await renderTab([
      makeRow({ id: 'a-prev', assessment_year: THIS_YEAR - 1, assessed_value: 100_000_000 }),
    ]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-assessed', '1000000');
    await press('property-assessment-review-save');

    const payload = mockCreateAssessment.mock.calls[0][1];
    expect(payload.changePercent).toBe(0);
    expect(payload.previousYearValue).toBe(100_000_000);
  });

  // Nothing to derive from is not the same as a 0% change: the first year ever
  // entered must go up with no YoY at all, not with a fabricated one.
  it('sends no change percentage when there is no preceding year', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');
    await type('property-assessment-review-assessed', '1000000');
    await press('property-assessment-review-save');

    const payload = mockCreateAssessment.mock.calls[0][1];
    expect(payload.changePercent).toBeUndefined();
    expect(payload.previousYearValue).toBeUndefined();
  });
});

describe('jurisdiction-aware labels', () => {
  // "Assessed value" is BC's term. An Ontario owner's notice says Current Value
  // Assessment, and eleven of thirteen provinces are not BC — the manual sheet
  // has to speak the same language the uploaded-notice sheet does.
  it('labels the value field with the province term (Ontario → CVA)', async () => {
    mockHouseholdState.current = {
      id: 'hh-1',
      country: 'CA',
      state_province: 'ON',
      purchase_price: null,
      purchase_date: null,
    };
    await renderTab([]);
    await press('property-assessment-add-manual');

    expect(screenText()).toContain('Current Value Assessment (CVA)');
  });

  it('falls back to the plain term in British Columbia', async () => {
    await renderTab([]);
    await press('property-assessment-add-manual');

    const text = screenText();
    expect(text).toContain('Assessed value · total');
    expect(text).not.toContain('Current Value Assessment');
  });
});
