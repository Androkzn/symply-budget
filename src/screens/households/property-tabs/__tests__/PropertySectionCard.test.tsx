/**
 * SectionCard regression — the year-over-year charts crashed on render.
 *
 * `SectionCard` referenced `colors` without calling `useAppColors()`, unlike its
 * siblings `StatGrid` and `InsightCard`. Every chart section on the property
 * tabs is wrapped in a `SectionCard`, and those charts only render once a
 * property has two or more years of data — so the crash landed exactly on the
 * "how has my assessment changed over time" view the feature exists for.
 *
 * The existing PropertyOverviewTab test missed it by seeding a single year
 * ("so no chart is drawn anyway"), and PropertyInsightWidgets.test.ts only
 * covers the pure formatters. This renders the component directly, which is the
 * cheapest thing that would have caught it.
 */

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { SectionCard, StatGrid, InsightCard } from '../PropertyInsightWidgets';

let tree: ReactTestRenderer.ReactTestRenderer;

async function render(node: React.ReactElement) {
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

afterEach(async () => {
  await act(async () => {
    try {
      tree?.unmount();
    } catch {
      /* already unmounted */
    }
  });
});

describe('SectionCard', () => {
  it('renders its title and children without throwing', async () => {
    await render(
      <SectionCard title="Assessed value trend">
        <Text>chart goes here</Text>
      </SectionCard>
    );

    const text = collectRenderedText(tree);
    expect(text).toContain('Assessed value trend');
    expect(text).toContain('chart goes here');
  });

  it('renders the right-hand slot when one is supplied', async () => {
    await render(
      <SectionCard title="Property tax trend" right={<Text>+12%</Text>}>
        <Text>bars</Text>
      </SectionCard>
    );

    expect(collectRenderedText(tree)).toEqual(
      expect.arrayContaining(['Property tax trend', '+12%', 'bars'])
    );
  });

  it('survives the multi-year case that used to crash it', async () => {
    // Two years of history is the threshold at which the tabs draw a chart, and
    // therefore the threshold at which this component first mounted in prod.
    const years = [2025, 2026];

    await render(
      <SectionCard title="Assessed value by year">
        {years.map((y) => (
          <Text key={y}>{`${y}: $1,180,000`}</Text>
        ))}
      </SectionCard>
    );

    const text = collectRenderedText(tree);
    expect(text).toContain('2025: $1,180,000');
    expect(text).toContain('2026: $1,180,000');
  });
});

describe('sibling widgets still render', () => {
  it('renders stat tiles', async () => {
    await render(
      <StatGrid
        stats={[
          {
            id: 'assessed',
            label: 'Assessed value',
            value: '$1.18M',
            subtitle: '+12% YoY',
            tone: 'positive',
          },
        ]}
      />
    );

    expect(collectRenderedText(tree)).toEqual(
      expect.arrayContaining(['Assessed value', '$1.18M', '+12% YoY'])
    );
  });

  it('renders an empty stat grid as nothing rather than an empty card', async () => {
    await render(<StatGrid stats={[]} />);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders an insight card', async () => {
    await render(
      <InsightCard
        insight={{
          id: 'appeal',
          title: 'Appeal window closes soon',
          body: 'Your complaint is due January 31.',
          severity: 'warning',
        }}
      />
    );

    expect(collectRenderedText(tree)).toEqual(
      expect.arrayContaining(['Appeal window closes soon', 'Your complaint is due January 31.'])
    );
  });
});
