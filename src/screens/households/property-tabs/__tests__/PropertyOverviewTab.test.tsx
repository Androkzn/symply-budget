/**
 * PropertyOverviewTab — the insights landing tab. Verifies the empty-state CTA
 * and that server-computed stat tiles + insight cards render. gifted-charts is
 * mocked (no native/SVG in jsdom); the with-data case uses a single-year history
 * so no chart is drawn anyway.
 */
jest.mock('react-native-gifted-charts', () => ({
  BarChart: () => null,
  LineChart: () => null,
  PieChart: () => null,
}));

import React from 'react';
import { TouchableOpacity } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';
import type { PropertyInsights } from '@features/utilities/api/utilities';

import { PropertyOverviewTab } from '../PropertyOverviewTab';

// Flatten the rendered tree into a single string so assertions don't care about
// the surrounding View/Text structure.
function textOf(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join(' ');
  return textOf((json as { children?: unknown }).children);
}

function renderTab(props: React.ComponentProps<typeof PropertyOverviewTab>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      React.createElement(ThemeProvider, null, React.createElement(PropertyOverviewTab, props))
    );
  });
  return tree;
}

const WITH_DATA: PropertyInsights = {
  hasData: true,
  assessment: {
    latest: null,
    history: [
      { year: 2026, assessedValue: 118100000, landValue: 92000000, improvementValue: 26100000, changePercent: 12.5 },
    ],
    yoy: { changeCents: 13100000, changePercent: 12.5 },
    landVsBuilding: { landValue: 92000000, improvementValue: 26100000 },
  },
  propertyTax: {
    latest: null,
    history: [{ year: 2026, taxAmount: 505334, assessedValue: 118100000, paid: false, dueDate: '2026-07-02' }],
    yoy: null,
    nextDue: { year: 2026, amount: 505334, dueDate: '2026-07-02', paid: false, grantEligible: true, grantApplied: false },
  },
  stats: [
    { id: 'assessed_value', label: 'Assessed value', value: '$1.18M', subtitle: '2026 · +12.5% YoY', tone: 'warning' },
    { id: 'next_due', label: 'Next payment', value: '$5,053', subtitle: 'Due Jul 2, 2026', tone: 'warning' },
  ],
  insights: [
    { id: 'grant_available', severity: 'positive', title: 'Claim your Home Owner Grant', body: 'Reduce what you owe.' },
  ],
};

describe('PropertyOverviewTab', () => {
  it('renders the empty-state CTA when there is no data', () => {
    const tree = renderTab({ insights: null, onGoToTax: jest.fn(), onGoToAssessment: jest.fn() });
    const text = textOf(tree.toJSON());
    expect(text).toContain('Start tracking this property');
    expect(text).toContain('Add assessment');
    expect(text).toContain('Add tax notice');
  });

  it('fires the empty-state actions', () => {
    const onGoToTax = jest.fn();
    const onGoToAssessment = jest.fn();
    const tree = renderTab({ insights: null, onGoToTax, onGoToAssessment });

    // The empty state renders exactly two buttons, in order: Add assessment, Add tax notice.
    const buttons = tree.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(2);
    act(() => buttons[0].props.onPress());
    act(() => buttons[1].props.onPress());
    expect(onGoToAssessment).toHaveBeenCalledTimes(1);
    expect(onGoToTax).toHaveBeenCalledTimes(1);
  });

  it('renders stat tiles and insight cards when data is present', () => {
    const tree = renderTab({ insights: WITH_DATA, onGoToTax: jest.fn(), onGoToAssessment: jest.fn() });
    const text = textOf(tree.toJSON());
    expect(text).toContain('Assessed value');
    expect(text).toContain('$1.18M');
    expect(text).toContain('Insights');
    expect(text).toContain('Claim your Home Owner Grant');
  });
});
