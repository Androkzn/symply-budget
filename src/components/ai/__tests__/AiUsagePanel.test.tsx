/**
 * AI usage panel — the per-day chart and the "how is this calculated" sheet.
 *
 * The chart's job is to be honest about time: the server returns one bucket per
 * calendar day, so a day nobody used AI must render as a flat tick, not as a
 * short bar (which reads as a small amount of spend) and not by being dropped
 * (which slides distant days next to each other).
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer, ReactTestInstance } from 'react-test-renderer';

import type { AIUsageResponse } from '@api/aiUsage';

import { renderOnDevice, treeText, pressables } from '../../../test-utils/deviceRender';
import { AiUsagePanel, axisTicks, densifyDays } from '../AiUsagePanel';

const day = (date: string, costUsd: number, requests = costUsd ? 1 : 0) => ({
  date,
  requests,
  tokens: requests * 2500,
  costUsd,
});

function usageFixture(byDay: AIUsageResponse['byDay']): AIUsageResponse {
  const requests = byDay.reduce((n, d) => n + d.requests, 0);
  return {
    currency: 'USD',
    range: { days: 7, rawWindowDays: 90, start: byDay[0].date, end: byDay[byDay.length - 1].date },
    provider: null,
    totals: {
      requests,
      tokens: byDay.reduce((n, d) => n + d.tokens, 0),
      costUsd: byDay.reduce((n, d) => n + d.costUsd, 0),
      errorRequests: 0,
    },
    estimate: { isEstimate: true, pricingVersion: '2026-07', unpricedRequests: 0 },
    byFeature: [],
    byModel: [],
    byProvider: [{ provider: 'anthropic', requests, tokens: 15000, costUsd: 0.02 }],
    byDay,
  };
}

const WEEK = [
  day('2026-08-28', 0),
  day('2026-08-29', 0.02),
  day('2026-08-30', 0),
  day('2026-08-31', 0),
  day('2026-09-01', 0.001),
  day('2026-09-02', 0),
  day('2026-09-03', 0),
];

const byTestID = (r: ReactTestRenderer, id: string): ReactTestInstance =>
  r.root.findAll((n) => n.props?.testID === id)[0];

/** The host node, not RN's composite wrapper — only the host has real children. */
const hostByTestID = (r: ReactTestRenderer, id: string): ReactTestInstance =>
  r.root.findAll((n) => n.props?.testID === id && typeof n.type === 'string')[0];

/**
 * Flattened style of every bar fill, in day order. A fill is the only leaf in
 * the strip — the tracks all wrap one.
 */
function barFills(r: ReactTestRenderer): Array<Record<string, unknown>> {
  return hostByTestID(r, 'ai-usage-panel-all-bars')
    .findAll((n) => typeof n.type === 'string' && n.children.length === 0)
    .map((fill) => Object.assign({}, ...[fill.props.style].flat(Infinity).filter(Boolean)));
}

describe('AiUsagePanel — per-day chart', () => {
  it('draws one column per calendar day, including the idle ones', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usageFixture(WEEK)} mode="all" testID="ai-usage-panel-all" />);

    expect(barFills(r)).toHaveLength(WEEK.length);
  });

  it('renders an idle day as a flat tick, not as a short bar', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usageFixture(WEEK)} mode="all" testID="ai-usage-panel-all" />);
    const fills = barFills(r);

    // 2026-08-28: no requests, no spend.
    expect(fills[0].height).toBe(2);
    // 2026-08-29: the busiest day, so full height.
    expect(fills[1].height).toBe('100%');
    // 2026-09-01: real but tiny — floored so it stays visible, never flat.
    expect(fills[4].height).toBe('6%');
  });

  it('labels a few anchor dates rather than all of them', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usageFixture(WEEK)} mode="all" testID="ai-usage-panel-all" />);
    const text = treeText(r);

    // First and last of the period anchor the axis.
    expect(text).toContain('8/28');
    expect(text).toContain('9/3');
    // Not every one of the seven days gets a label.
    const labelled = WEEK.filter((d) => text.includes(`${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`));
    expect(labelled.length).toBeLessThan(WEEK.length);
  });
});

describe('densifyDays — surviving an older Worker', () => {
  it('fills the period from the range bounds', () => {
    const out = densifyDays([day('2026-09-02', 0.02)], '2026-08-31', '2026-09-03');

    expect(out.map((d) => d.date)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(out.map((d) => d.costUsd)).toEqual([0, 0, 0.02, 0]);
  });

  it('still closes interior gaps when the server sent no bounds', () => {
    // The deployed Worker predates `range.start` / `range.end`: 22 July and
    // 16 August must not end up as neighbouring bars.
    const out = densifyDays([day('2026-07-22', 0.02), day('2026-08-16', 0.001)]);

    expect(out).toHaveLength(26);
    expect(out[0].date).toBe('2026-07-22');
    expect(out[25].date).toBe('2026-08-16');
    expect(out.filter((d) => d.requests === 0)).toHaveLength(24);
  });

  it('leaves an empty series alone', () => {
    expect(densifyDays([])).toEqual([]);
  });
});

describe('axisTicks', () => {
  it('passes short series through untouched', () => {
    expect(axisTicks(['a', 'b', 'c'], 4)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the first and last date and spaces the rest evenly', () => {
    const dates = Array.from({ length: 91 }, (_, i) => `d${i}`);
    expect(axisTicks(dates, 4)).toEqual(['d0', 'd30', 'd60', 'd90']);
  });
});

describe('AiUsagePanel — methodology sheet', () => {
  it('offers an info affordance beside the ESTIMATE badge', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usageFixture(WEEK)} mode="all" testID="ai-usage-panel-all" />);

    expect(treeText(r)).toContain('ESTIMATE');
    expect(byTestID(r, 'ai-usage-panel-all-method-toggle')).toBeTruthy();
  });

  it('explains where the tokens, the dollars and the empty days come from', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usageFixture(WEEK)} mode="all" testID="ai-usage-panel-all" />);

    act(() => {
      byTestID(r, 'ai-usage-panel-all-method-toggle').props.onPress();
    });

    const text = treeText(r);
    expect(text).toContain('Tokens are measured, not guessed.');
    expect(text).toContain('rates 2026-07');
    expect(text).toContain('One bar is one day.');
    expect(text).toContain('The last 90 days are summed from individual requests');
  });

  it('qualifies the total when some requests used an unrecognised model', () => {
    const usage = usageFixture(WEEK);
    usage.estimate.unpricedRequests = 3;
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usage} mode="all" testID="ai-usage-panel-all" />);

    act(() => {
      byTestID(r, 'ai-usage-panel-all-method-toggle').props.onPress();
    });

    expect(treeText(r)).toContain('3 requests used a model missing from our table');
  });

  it('keeps the info affordance reachable with no usage at all', () => {
    // The empty state replaces the chart, but "why is this $0.00?" is exactly
    // when someone reaches for the explanation.
    const usage = usageFixture([day('2026-09-03', 0)]);
    const r = renderOnDevice('iPhone 14 Pro', <AiUsagePanel usage={usage} mode="all" testID="ai-usage-panel-all" />);

    expect(treeText(r)).toContain('No AI usage recorded for this period yet.');
    expect(pressables(r).some((p) => p.props.testID === 'ai-usage-panel-all-method-toggle')).toBe(true);
  });
});
