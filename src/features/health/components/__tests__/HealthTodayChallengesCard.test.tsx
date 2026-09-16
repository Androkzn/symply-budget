/**
 * HealthTodayChallengesCard — the "Today's Challenges" widget on the
 * Nutrition screen (donor `TodayChallengesCard`).
 *
 * Self-contained: fetches its own progress on focus, via the same
 * `healthChallengesStorage` the Dashboard's `HealthFoodChallengesWidget`
 * uses. This suite drives the loader directly (mocked) and pins the donor
 * layout surviving the port — ring + name + "Xg left"/"Complete" + bar +
 * "Xg / Yg" + percent — and that the card renders NOTHING when there is no
 * applicable challenge today or the read fails, exactly like the donor's
 * `if total > 0`.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { HealthChallengeTodayEntry, HealthChallengeTodayResponse } from '@api/health';
import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthTodayChallengesCard } from '../HealthTodayChallengesCard';

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactMock = require('react');
    ReactMock.useEffect(() => callback(), [callback]);
  },
}));

const mockLoadChallengeProgressToday = jest.fn();
jest.mock('../../healthChallengesStorage', () => {
  const actual = jest.requireActual('../../healthChallengesStorage');
  return {
    ...actual,
    loadChallengeProgressToday: () => mockLoadChallengeProgressToday(),
  };
});

type Rendered = ReactTestRenderer.ReactTestRenderer;

async function render(element: React.ReactElement): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

/** Concatenated text of the whole tree. */
function textOf(tree: Rendered): string {
  return tree.root
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join(' ');
}

const ISO = '2026-07-13T08:00:00.000Z';

function row(over: Partial<HealthChallengeTodayEntry> = {}): HealthChallengeTodayEntry {
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
    consumed_grams: 150,
    remaining_grams: 250,
    today_completed: false,
    matched_foods: [],
    progress_percentage: 150 / 400,
    ...over,
  };
}

function response(challenges: HealthChallengeTodayEntry[]): HealthChallengeTodayResponse {
  return {
    date: '2026-07-13',
    challenges,
    completed_count: challenges.filter((c) => c.today_completed).length,
    total_count: challenges.length,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('HealthTodayChallengesCard', () => {
  it('renders nothing once loaded with zero applicable challenges today', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(response([]));
    const tree = await render(<HealthTodayChallengesCard />);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing when the progress read fails, rather than an error state', async () => {
    mockLoadChallengeProgressToday.mockRejectedValue(new Error('offline'));
    const tree = await render(<HealthTodayChallengesCard />);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders nothing when the read resolves null (offline, nothing cached)', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(null);
    const tree = await render(<HealthTodayChallengesCard />);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders the donor layout: name, "Xg left", the amount pair and percent', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(
      response([row({ consumed_grams: 150, remaining_grams: 250, target_grams: 400, progress_percentage: 150 / 400 })])
    );
    const tree = await render(<HealthTodayChallengesCard />);

    const text = textOf(tree);
    expect(text).toContain('Vegetables');
    expect(text).toContain('250g left');
    expect(text).toContain('150g / 400g');
    expect(text).toContain('38%'); // round(150/400*100)
  });

  it('shows "Complete" instead of a remaining count once a challenge is done', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(
      response([
        row({
          consumed_grams: 400,
          remaining_grams: 0,
          target_grams: 400,
          today_completed: true,
          progress_percentage: 1,
        }),
      ])
    );
    const tree = await render(<HealthTodayChallengesCard />);
    expect(textOf(tree)).toContain('Complete');
  });

  it('a custom-ingredient challenge shows its own name', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(
      response([
        row({
          name: 'Avocado',
          category: 'custom_ingredient',
          target_food_name: 'avocado',
          consumed_grams: 0,
          remaining_grams: 50,
          target_grams: 50,
          progress_percentage: 0,
        }),
      ])
    );
    const tree = await render(<HealthTodayChallengesCard />);
    expect(textOf(tree)).toContain('Avocado');
  });

  it('the header count reflects completed vs total, from the response — never re-derived', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(
      response([
        row({ id: 'a', today_completed: true, consumed_grams: 400, remaining_grams: 0, target_grams: 400, progress_percentage: 1 }),
        row({ id: 'b', name: 'Nuts', category: 'nuts', target_grams: 30, consumed_grams: 0, remaining_grams: 30, today_completed: false, progress_percentage: 0 }),
      ])
    );
    const tree = await render(<HealthTodayChallengesCard />);
    expect(textOf(tree)).toContain('1/2');
  });

  it('an overshoot reads past 100%, uncapped, matching the shared challengePercent helper', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(
      response([
        row({ consumed_grams: 560, remaining_grams: 0, target_grams: 400, progress_percentage: 560 / 400 }),
      ])
    );
    const tree = await render(<HealthTodayChallengesCard />);
    expect(textOf(tree)).toContain('140%');
  });

  it('the header count is pressable only when onManage is supplied', async () => {
    mockLoadChallengeProgressToday.mockResolvedValue(response([row()]));

    const withoutHandler = await render(<HealthTodayChallengesCard />);
    const disabledCount = withoutHandler.root.findAll(
      (n) => n.props?.testID === 'health-today-challenges-card-count'
    )[0];
    expect(disabledCount.props.disabled).toBe(true);

    const onManage = jest.fn();
    const withHandler = await render(<HealthTodayChallengesCard onManage={onManage} />);
    const enabledCount = withHandler.root.findAll(
      (n) => n.props?.testID === 'health-today-challenges-card-count'
    )[0];
    expect(enabledCount.props.disabled).toBe(false);
    act(() => enabledCount.props.onPress());
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
