/**
 * `useHomeInsight` — the Home hero, from two sources through one shape (DoD H7).
 *
 * The gap this closes is that `buildHomeInsights` existed, was tested, and had
 * no production importer: the hero brief still came from a Worker whose D1 is
 * empty for a local-first household, so it would cheerfully report "All clear"
 * over a month of overdue work. These tests lock the wiring and the projection.
 *
 * The `HomeInsight` NAME COLLISION is the trap this file is most careful about.
 * `@/types/aihousekeeper`'s `HomeInsight` is one composed hero brief (greeting,
 * tone, icon, chips); `features/house/local/ai`'s is a LIST of insight cards
 * (kind, detail, priority). `projectHeroInsight` is the only bridge and is
 * exported precisely so it can be tested without a query client.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { projectHeroInsight, useHomeInsight } from '@hooks/useHomeInsight';

const mockState = {
  localFirst: true,
  ledger: {} as Record<string, unknown>,
  result: { stage: 'A', value: [] } as unknown,
};

jest.mock('@features/house/local', () => ({
  __esModule: true,
  isHouseLocalFirst: () => mockState.localFirst,
  getLocalHouseLedgerFor: jest.fn(async () => mockState.ledger),
  buildHomeInsights: jest.fn(async () => mockState.result),
  getHouseAiUnavailableCopy: (reason: string) => ({
    title: reason === 'no_key' ? 'Add an AI key to use this' : 'The assistant cannot answer that yet',
    message: 'Your home data stays on your devices…',
  }),
}));

jest.mock('@api/aihousekeeper', () => ({
  __esModule: true,
  aihousekeeperApi: {
    getHomeInsight: jest.fn(async () => ({
      greeting: 'Good morning',
      title: 'From the server',
      message: 'Composed in D1.',
      tone: 'info',
      icon: 'information-circle',
      dueLabel: null,
      dueDate: null,
      cta: null,
      attentionCount: 0,
      chips: [],
      generatedAt: '2026-08-14T00:00:00.000Z',
    })),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const local = require('@features/house/local') as {
  buildHomeInsights: jest.Mock;
  getLocalHouseLedgerFor: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('@api/aihousekeeper') as { aihousekeeperApi: { getHomeInsight: jest.Mock } };

type HookValue = ReturnType<typeof useHomeInsight>;

const mounted: Array<{ renderer: ReactTestRenderer.ReactTestRenderer; client: QueryClient }> = [];

afterEach(() => {
  // React Query keeps timers alive per client; unmounting and clearing keeps
  // Jest from hanging after the last assertion.
  for (const { renderer, client } of mounted.splice(0)) {
    act(() => renderer.unmount());
    client.clear();
  }
});

/**
 * Render the hook inside a fresh query client and settle its first fetch.
 *
 * Flushed in a loop rather than with a fixed number of ticks: the local branch
 * awaits the ledger and then the ladder, the server branch awaits one request,
 * and a hardcoded tick count that happens to suit one of them makes the other
 * flaky rather than failing.
 */
async function renderInsight(householdId = 'hh1'): Promise<HookValue> {
  const box = { current: null as unknown as HookValue };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Harness() {
    box.current = useHomeInsight(householdId);
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  mounted.push({ renderer, client });

  for (let i = 0; i < 20; i += 1) {
    if (!box.current.isLoading) break;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return box.current;
}

const OVERDUE = {
  id: 'task_overdue:t1',
  kind: 'task_overdue' as const,
  title: 'Change the furnace filter',
  detail: '11 days overdue.',
  priority: 'high' as const,
  source: 'rules' as const,
  taskId: 't1',
};

describe('useHomeInsight — source selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.localFirst = true;
    mockState.result = { stage: 'A', value: [] };
  });

  it('uses the server composer on a non-local-first build and never reads the ledger', async () => {
    mockState.localFirst = false;
    const value = await renderInsight();

    expect(value.insight?.title).toBe('From the server');
    expect(value.unavailable).toBeNull();
    expect(api.aihousekeeperApi.getHomeInsight).toHaveBeenCalledTimes(1);
    expect(local.getLocalHouseLedgerFor).not.toHaveBeenCalled();
    expect(local.buildHomeInsights).not.toHaveBeenCalled();
  });

  it('builds the brief on device under local-first and never calls the Worker', async () => {
    mockState.result = { stage: 'A', value: [OVERDUE] };
    const value = await renderInsight();

    expect(value.insight?.title).toBe('Change the furnace filter');
    expect(api.aihousekeeperApi.getHomeInsight).not.toHaveBeenCalled();
    expect(local.buildHomeInsights).toHaveBeenCalledWith({
      ledger: mockState.ledger,
      householdId: 'hh1',
    });
  });

  it('returns Stage C as copy on `unavailable`, with no fabricated brief', async () => {
    mockState.result = { stage: 'C', reason: 'no_key' };
    const value = await renderInsight();

    // The two halves of one answer; never both at once.
    expect(value.insight).toBeNull();
    expect(value.unavailable).toEqual({
      title: 'Add an AI key to use this',
      message: 'Your home data stays on your devices…',
    });
    expect(JSON.stringify(value.unavailable)).not.toContain('no_key');
  });
});

describe('projectHeroInsight', () => {
  const NOW = new Date('2026-08-14T09:00:00');

  it('turns an empty list into the celebrate/all-clear hero, not a blank card', () => {
    const hero = projectHeroInsight([], NOW);
    expect(hero.title).toBe('All clear');
    expect(hero.tone).toBe('celebrate');
    expect(hero.cta).toBeNull();
    expect(hero.attentionCount).toBe(0);
  });

  it('promotes the head of the ranked list and demotes the next three to chips', () => {
    const list = [
      OVERDUE,
      { ...OVERDUE, id: 'b', title: 'B', kind: 'task_due_soon' as const, priority: 'medium' as const },
      { ...OVERDUE, id: 'c', title: 'C', kind: 'appliance_service_due' as const, priority: 'low' as const },
      { ...OVERDUE, id: 'd', title: 'D', kind: 'appliance_end_of_life' as const, priority: 'low' as const },
      { ...OVERDUE, id: 'e', title: 'E', kind: 'assistant_suggestion' as const, priority: 'low' as const },
    ];
    const hero = projectHeroInsight(list, NOW);

    expect(hero.title).toBe('Change the furnace filter');
    expect(hero.message).toBe('11 days overdue.');
    expect(hero.tone).toBe('urgent');
    // 1 + 3, the same shape the Worker produces.
    expect(hero.chips.map((c) => c.label)).toEqual(['B', 'C', 'D']);
  });

  it('counts only the things that actually want attention', () => {
    const list = [
      OVERDUE,
      { ...OVERDUE, id: 'low', priority: 'low' as const },
      { ...OVERDUE, id: 'mid', priority: 'medium' as const },
    ];
    // A "warranty ends next year" is not something needing you now.
    expect(projectHeroInsight(list, NOW).attentionCount).toBe(2);
  });

  it('only offers CTA routes the app actually has', () => {
    expect(projectHeroInsight([OVERDUE], NOW).cta).toEqual({
      label: 'Review tasks',
      route: '/tasks',
    });
    expect(
      projectHeroInsight([{ ...OVERDUE, taskId: undefined, applianceId: 'a1' }], NOW).cta,
    ).toEqual({ label: 'View appliances', route: '/appliances' });
    // Neither a task nor an appliance → no CTA, and the card falls back to chat
    // exactly as it does on the server path.
    expect(
      projectHeroInsight(
        [{ ...OVERDUE, taskId: undefined, kind: 'assistant_suggestion' as const }],
        NOW,
      ).cta,
    ).toBeNull();
  });

  it('greets on the local hour, matching the Worker s greetingForHour', () => {
    expect(projectHeroInsight([], new Date('2026-08-14T08:00:00')).greeting).toBe('Good morning');
    expect(projectHeroInsight([], new Date('2026-08-14T13:00:00')).greeting).toBe('Good afternoon');
    expect(projectHeroInsight([], new Date('2026-08-14T20:00:00')).greeting).toBe('Good evening');
  });

  it('does not invent a due label from prose', () => {
    // The rules carry no relative-day field; parsing `detail` for one is how a
    // hero starts asserting dates it does not know.
    const hero = projectHeroInsight([OVERDUE], NOW);
    expect(hero.dueLabel).toBeNull();
    expect(hero.dueDate).toBeNull();
  });
});
