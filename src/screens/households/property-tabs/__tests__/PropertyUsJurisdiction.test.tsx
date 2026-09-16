/**
 * US property screens — the three structural differences that break a
 * Canada-shaped screen.
 *
 * The US registry and the gate landed before the screens did, so for a while a
 * Houston household passed `isPropertyAssessmentSupported` and then read
 * generic fallback copy: the tabs still called the Canada-only hook, which
 * returns null for a US address. These tests pin the three facts that made a
 * shared code path wrong rather than merely incomplete:
 *
 *   1. A rate is quoted per $1,000 in most states, per $100 in Texas, and as a
 *      percent in California. Mislabelling it is a 10x error on a real bill.
 *   2. An assessment ratio belongs to a taxing-district CLASS, not a property.
 *      Colorado assesses the same home at 7.05% for school levies and 6.80%
 *      for local government, so there is no single taxable value to show.
 *   3. Value is a stack — market, capped, taxable — and the gap between the
 *      first two is a legally named amount a member can lose by selling.
 *
 * Plus two things that are not about arithmetic but would mislead just as
 * badly: New York's STAR credit is a cheque, not a reduction on the bill, and
 * Florida's second homestead exemption does not reach school levies.
 */

jest.mock('@components/ui/BottomSheet', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? children : null,
}));

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
const mockGetTaxes = jest.fn();
jest.mock('@features/utilities/api/utilities', () => ({
  utilitiesApi: {
    getBCAssessments: (...a: unknown[]) => mockGetAssessments(...a),
    createBCAssessment: jest.fn(),
    updateBCAssessment: jest.fn(),
    uploadAndExtractAssessment: jest.fn(),
    getPropertyTaxes: (...a: unknown[]) => mockGetTaxes(...a),
    createPropertyTax: jest.fn(),
    updatePropertyTax: jest.fn(),
    uploadAndExtractPropertyTax: jest.fn(),
  },
}));

// The PROPERTY's address decides the jurisdiction, never the user's locale.
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

import { PropertyAssessmentTab } from '../PropertyAssessmentTab';
import { PropertyTaxTab } from '../PropertyTaxTab';

let tree: ReactTestRenderer.ReactTestRenderer;

function flatText(json: unknown): string {
  if (json == null || json === false) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(flatText).join(' ');
  return flatText((json as { children?: unknown }).children);
}

/**
 * The whole screen as one string. Every label under test is interpolated —
 * `Look up your property at {authorityName}` arrives as separate text nodes —
 * so `collectRenderedText`, which only sees single-string children, cannot see
 * any of it. Asserting through it would have passed vacuously on copy that was
 * never rendered.
 */
function screenText(): string {
  return flatText(tree.toJSON()).replace(/\s+/g, ' ');
}

function setHousehold(country: string, region: string) {
  mockHouseholdState.current = {
    id: 'hh-1',
    name: 'Test property',
    country,
    state_province: region,
    city: 'Somewhere',
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function renderAssessment() {
  mockGetAssessments.mockResolvedValue([]);
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PropertyAssessmentTab householdId="hh-1" onChanged={jest.fn()} />
      </ThemeProvider>
    );
  });
  await flush();
  return screenText();
}

async function renderTax() {
  mockGetTaxes.mockResolvedValue([]);
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PropertyTaxTab householdId="hh-1" onChanged={jest.fn()} />
      </ThemeProvider>
    );
  });
  await flush();
  return screenText();
}

beforeEach(() => {
  mockHouseholdState.current = null;
  jest.clearAllMocks();
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

describe('Texas — the office and the rate basis', () => {
  it('names the appraisal district, not a county assessor', async () => {
    // Texas appraisal districts are independent political subdivisions; the
    // county tax assessor-collector only collects. Calling it "your county
    // assessor" names an office that does not do this job.
    setHousehold('US', 'TX');
    expect(await renderAssessment()).toMatch(/Appraisal District/i);
  });

  it('tells a Texan the rate is per $100, not mills', async () => {
    // Most states quote mills per $1,000. Reading a Texas rate as mills is a
    // 10x error on the amount owed.
    setHousehold('US', 'TX');
    const text = await renderTax();
    expect(text).toMatch(/\$100/);
  });
});

describe('California — Proposition 13', () => {
  it('shows the cap that makes assessed value diverge from market value', async () => {
    // Prop 13 freezes the base year value and limits growth to 2% a year until
    // a sale. Without it on screen, a Californian cannot reconcile their
    // assessed value with what the house is worth.
    setHousehold('US', 'CA');
    const text = await renderAssessment();
    expect(text).toMatch(/Proposition 13|Prop\.? 13/i);
  });
});

describe('Colorado — a ratio that belongs to a district class', () => {
  it('explains why there is no single taxable value instead of inventing one', async () => {
    // The same home is assessed at 7.05% for school levies and 6.80% for local
    // government. Any single computed "taxable value" would be wrong for one of
    // them, so the screen must explain rather than calculate.
    setHousehold('US', 'CO');
    const text = await renderAssessment();
    // The screen labels the rung "Assessed value (differs per district class)"
    // rather than attaching a figure to it — that parenthetical IS the
    // explanation, and it is what must survive a refactor.
    expect(text).toMatch(/differs per district class|taxing district|levies/i);
  });

  it('never prints a computed taxable figure for Colorado', async () => {
    // The failure this guards is silent: a plausible dollar amount that no bill
    // will ever agree with.
    setHousehold('US', 'CO');
    const text = await renderAssessment();
    expect(text).not.toMatch(/Taxable (assessment|value):\s*\$[\d,]+/i);
  });
});

describe('New York — STAR is a cheque, not a discount', () => {
  it('does not present the STAR credit as reducing the bill', async () => {
    // New homeowners get the credit as a payment from the state; only legacy
    // recipients hold the exemption that touches the bill. Showing it as a
    // reduction would have someone expect a smaller bill that never arrives.
    setHousehold('US', 'NY');
    const text = await renderAssessment();
    if (/STAR/i.test(text)) {
      expect(text).not.toMatch(/STAR[^•]{0,80}reduces your (bill|tax)/i);
    }
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('Florida — an exemption that skips school levies', () => {
  it('says the additional exemption does not reach school taxes', async () => {
    // The first $25,000 applies to every levy; the second applies only to
    // non-school levies. Implying both apply everywhere overstates the relief.
    setHousehold('US', 'FL');
    const text = await renderAssessment();
    expect(text).toMatch(/school/i);
  });
});

describe('escrow — most US owners never receive the bill', () => {
  it('explains the servicer route on a US tax surface', async () => {
    // The county mails the bill to the mortgage servicer and the owner gets an
    // information-only statement. Without this, "no tax record" reads as
    // "nothing owed".
    setHousehold('US', 'TX');
    expect(await renderTax()).toMatch(/escrow|servicer|mortgage/i);
  });

  it('says nothing about escrow for a Canadian household', async () => {
    // Canadian owners are billed directly; the note would be noise at best and
    // wrong at worst.
    setHousehold('CA', 'BC');
    expect(await renderTax()).not.toMatch(/escrow|mortgage servicer/i);
  });
});

describe('Canada is unchanged', () => {
  it('still names BC Assessment for a British Columbia property', async () => {
    // The whole US conversion is worthless if it costs the Canadian behaviour
    // that already shipped.
    setHousehold('CA', 'BC');
    expect(await renderAssessment()).toMatch(/BC Assessment/);
  });

  it('still names MPAC and Ontario’s own value term', async () => {
    setHousehold('CA', 'ON');
    const text = await renderAssessment();
    expect(text).toMatch(/MPAC|Current Value Assessment/i);
  });

  it('offers no US-only sections to a Canadian property', async () => {
    // The value stack and cap sections are US constructs; Canada has one
    // meaningful value and no acquisition-value cap.
    setHousehold('CA', 'BC');
    const text = await renderAssessment();
    expect(text).not.toMatch(/Homestead cap loss/i);
  });
});

describe('an unseeded region', () => {
  it('falls back to generic copy rather than another region’s rules', async () => {
    // Washington is not among the seeded states. Showing it Texas's appraisal
    // district or BC's Home Owner Grant would be worse than showing nothing.
    setHousehold('US', 'WA');
    const text = await renderAssessment();
    expect(text).not.toMatch(/Appraisal District|BC Assessment|Home Owner Grant/i);
  });
});
