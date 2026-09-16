/**
 * The two real consumers wired through the ladder (plan §9, DoD H7).
 *
 * A ladder with no riders proves nothing, so this suite exercises the two
 * features the locked assignment actually names:
 *
 *  - **garbage day** — *"garbage AI-detect → P2 BYOK; Stage-A deterministic
 *    parse works with no key"*;
 *  - **`maintenance_suggestions` / home insight** — *"P1 on-device rules;
 *    suggestions get simpler than the server's AI pass"*.
 *
 * The Stage-A cases below inject a BYOK port whose every method **throws**, and
 * a `fetch` that throws too. If a deterministic answer still comes back, Stage A
 * is genuinely offline and key-free — which is the DoD's first checkbox proved
 * by construction rather than by reading the code.
 *
 * The Stage-B cases capture the request the port received, so the assertions are
 * about the bytes that would have left the device: the projected fields that are
 * there, and — the part that matters — the address, the member names, the free
 * text and the serial numbers that are not.
 *
 * Static imports only — `await import()` throws under this Jest config (§6.2).
 */
import type { GarbageScheduleType } from '@api/garbage-collection';

import {
  getHouseAiUnavailableCopy,
  houseAiUnavailable,
  HouseAiUnavailableError,
} from '../ai/houseAiLadder';
import type { HouseByokPort, HouseByokRequest } from '../ai/houseByokClient';
import {
  inferGarbageDay,
  inferGarbageDayStageA,
  normalizeInferredStreams,
} from '../ai/houseGarbageDayInference';
import {
  buildHomeInsights,
  buildHomeInsightsStageA,
  normalizeAssistantInsights,
  MAX_HOME_INSIGHTS,
} from '../ai/houseHomeInsights';
import type {
  LocalAppliance,
  LocalApplianceServiceHistory,
  LocalGarbageSchedule,
  LocalHomeFeature,
  LocalTask,
} from '../types';

/** Monday 10 August 2026, 06:00 — before the 07:00 collection cut-off. */
const MONDAY_EARLY = new Date(2026, 7, 10, 6, 0, 0);
/** Thursday 13 August 2026 — the reference "today" for the insight rules. */
const TODAY = new Date(2026, 7, 13, 9, 0, 0);

const HH = 'hh-1';
const LEAK_KEY = 'sk-ant-api03-CONSUMER-TEST-KEY-999999';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function schedule(overrides: Partial<LocalGarbageSchedule> = {}): LocalGarbageSchedule {
  return {
    id: 'gs-1',
    household_id: HH,
    municipality: 'Burnaby',
    schedules: [],
    set_out_time: '19:00',
    holiday_shifts: [{ holiday: 'Canada Day', date: '2026-07-01', shiftDays: 1, affectedDays: [3] }],
    reminders: {
      nightBefore: { enabled: true, time: '19:00' },
      morningOf: { enabled: false, time: '07:00' },
    },
    source: 'manual',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const weekly = (
  type: GarbageScheduleType['type'],
  dayOfWeek: number,
): GarbageScheduleType => ({ type, frequency: 'weekly', dayOfWeek });

function task(overrides: Partial<LocalTask> = {}): LocalTask {
  return {
    id: 'task-1',
    household_id: HH,
    system_category: 'hvac',
    title: 'Replace furnace filter',
    description: 'Panel is behind the boiler; gate code 4792',
    frequency: 'monthly',
    custom_interval_days: null,
    next_due_date: '2026-12-01',
    last_completed_at: null,
    assigned_to: { id: 'user-9', display_name: 'Sam Delgado' },
    is_active: true,
    source: 'manual',
    reminder_enabled: true,
    reminder_days_before: 3,
    reminder_time: '09:00',
    reminder_repeat: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function appliance(overrides: Partial<LocalAppliance> = {}): LocalAppliance {
  return {
    id: 'app-1',
    household_id: HH,
    name: 'Furnace',
    category: 'hvac',
    type: 'gas',
    brand: 'Lennox',
    model: 'ML195',
    serial_number: 'LX-88-114-2231',
    location: 'Utility room',
    purchase_cost: 6400,
    total_maintenance_cost: 420,
    created_at: '2019-04-02T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function serviceEntry(
  overrides: Partial<LocalApplianceServiceHistory> = {},
): LocalApplianceServiceHistory {
  return {
    id: 'svc-1',
    household_id: HH,
    appliance_id: 'app-1',
    service_date: '2026-06-01',
    description: 'Annual service by Ridgeline Heating, 604-555-0142',
    provider_name: 'Ridgeline Heating',
    cost: 240,
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function homeFeature(overrides: Partial<LocalHomeFeature> = {}): LocalHomeFeature {
  return {
    id: 'hf-1',
    household_id: HH,
    feature_type: 'roof',
    feature_subtype: 'asphalt_shingle',
    quantity: 1,
    location: 'Whole house',
    brand: null,
    model: null,
    serial_number: null,
    install_date: '2014-06-01',
    warranty_expires: null,
    age_years: 12,
    condition: 'fair',
    notes: 'Neighbour Mrs Delgado has the roofer’s number',
    source: 'manual',
    source_report_id: null,
    extraction_confidence: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// BYOK ports
// ---------------------------------------------------------------------------

/**
 * A port that fails if anything touches it. Stage A must not consult the
 * Keychain, let alone the network.
 */
const OFFLINE_PORT: HouseByokPort = {
  hasKey: async () => {
    throw new Error('Stage A must not consult the key vault');
  },
  generate: async () => {
    throw new Error('Stage A must not reach a provider');
  },
};

/** A port with no key — the member who never supplied one. */
const NO_KEY_PORT: HouseByokPort = {
  hasKey: async () => false,
  generate: async () => {
    throw new Error('Stage B must not run without a key');
  },
};

function keyedPort(generate: jest.Mock): HouseByokPort {
  return {
    hasKey: async () => true,
    generate: generate as unknown as HouseByokPort['generate'],
  };
}

function requestSeenBy(generate: jest.Mock, call = 0): HouseByokRequest {
  return generate.mock.calls[call]![0] as HouseByokRequest;
}

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn(() => {
    throw new Error('no test in this file may reach the network');
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ===========================================================================
// Garbage day
// ===========================================================================

describe('garbage day — Stage A works offline with no key', () => {
  it('computes the next pickup from the saved schedule', async () => {
    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [weekly('garbage', 3)] })] },
      today: MONDAY_EARLY,
      byok: OFFLINE_PORT,
    });

    expect(result.stage).toBe('A');
    if (result.stage !== 'A') throw new Error('unreachable');
    expect(result.value.source).toBe('schedule');
    expect(result.value.needsConfirmation).toBe(false);
    expect(result.value.next[0]).toEqual({ date: '2026-08-12', types: ['garbage'] });
    expect(result.value.summary).toBe('Garbage goes out Wed 12 Aug.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('merges streams that land on the same day into one line', async () => {
    const result = await inferGarbageDay({
      ledger: {
        garbageSchedules: [
          { ...schedule(), schedules: [weekly('garbage', 3), weekly('recycling', 3)] },
        ],
      },
      today: MONDAY_EARLY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.next[0]!.types).toEqual(['garbage', 'recycling']);
    expect(result.value.summary).toBe('Garbage and recycling go out Wed 12 Aug.');
  });

  it('answers honestly when the streams produce no dates in the window', async () => {
    // An on-request-only municipality. "Nothing scheduled" is a deterministic
    // ANSWER — escalating it to a paid provider would buy the member nothing.
    const result = await inferGarbageDay({
      ledger: {
        garbageSchedules: [
          { ...schedule(), schedules: [{ type: 'bulkItem', frequency: 'on-request' }] },
        ],
      },
      today: MONDAY_EARLY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.next).toEqual([]);
    expect(result.value.summary).toBe('Nothing is scheduled for collection in the next 30 days.');
  });

  it('picks the right property on a multi-property device', async () => {
    const result = await inferGarbageDay({
      ledger: {
        garbageSchedules: [
          schedule({ id: 'gs-1', household_id: 'hh-1', schedules: [weekly('garbage', 3)] }),
          schedule({ id: 'gs-2', household_id: 'hh-2', schedules: [weekly('garbage', 5)] }),
        ],
      },
      householdId: 'hh-2',
      today: MONDAY_EARLY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.next[0]).toEqual({ date: '2026-08-14', types: ['garbage'] });
  });

  it('ignores a half-written stream rather than taking the card down', async () => {
    const broken = [{ type: undefined, frequency: 'weekly' }] as unknown as GarbageScheduleType[];
    const result = await inferGarbageDay({
      ledger: {
        garbageSchedules: [{ ...schedule(), schedules: [...broken, weekly('organics', 3)] }],
      },
      today: MONDAY_EARLY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.streams).toEqual([weekly('organics', 3)]);
  });

  it('the pure Stage A function needs nothing but a row and a date', () => {
    const answer = inferGarbageDayStageA(
      schedule({ schedules: [weekly('recycling', 1)] }),
      MONDAY_EARLY,
      30,
    );
    expect(answer!.next[0]).toEqual({ date: '2026-08-10', types: ['recycling'] });
  });
});

describe('garbage day — Stage B, and what it is allowed to send', () => {
  it('falls to Stage C `no_key` when the schedule is unconfigured and no key exists', async () => {
    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [] })] },
      today: MONDAY_EARLY,
      byok: NO_KEY_PORT,
    });
    expect(result).toEqual({ stage: 'C', reason: 'no_key' });
  });

  it('sends the municipality and NOTHING else from the schedule row', async () => {
    const generate = jest.fn().mockResolvedValue({
      schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: 3 }],
    });

    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [] })] },
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });

    expect(result.stage).toBe('B');
    const sent = requestSeenBy(generate);
    // The whole payload, spelled out. `schedules`, `set_out_time`,
    // `holiday_shifts`, `reminders`, `source` and `household_id` are all real
    // fields on the row and none of them is allowlisted.
    expect(sent.context.tables.garbageSchedules).toEqual([{ id: 'gs-1', municipality: 'Burnaby' }]);
    const serialized = JSON.stringify(sent.context);
    expect(serialized).not.toContain('19:00');
    expect(serialized).not.toContain('Canada Day');
    expect(serialized).not.toContain('hh-1');
    expect(serialized).not.toContain('nightBefore');
  });

  it('sends only the addressed property’s municipality, not every home’s', async () => {
    const generate = jest.fn().mockResolvedValue({ schedules: [] });
    await inferGarbageDay({
      ledger: {
        garbageSchedules: [
          schedule({ id: 'gs-1', household_id: 'hh-1', municipality: 'Burnaby' }),
          schedule({ id: 'gs-2', household_id: 'hh-2', municipality: 'Squamish' }),
        ],
      },
      householdId: 'hh-2',
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });

    const serialized = JSON.stringify(requestSeenBy(generate).context);
    expect(serialized).toContain('Squamish');
    expect(serialized).not.toContain('Burnaby');
  });

  it('computes the dates on device even from the assistant’s pattern', async () => {
    const generate = jest.fn().mockResolvedValue({
      schedules: [{ type: 'recycling', frequency: 'weekly', dayOfWeek: 3 }],
    });

    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [] })] },
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });

    if (result.stage !== 'B') throw new Error('expected Stage B');
    expect(result.value.source).toBe('assistant');
    // A model is not allowed to do calendar arithmetic a member will act on.
    expect(result.value.next[0]).toEqual({ date: '2026-08-12', types: ['recycling'] });
    expect(result.value.needsConfirmation).toBe(true);
    expect(result.value.summary).toContain('Check this against your city');
  });

  it('falls to Stage C when the assistant returns nothing usable', async () => {
    const generate = jest.fn().mockResolvedValue({
      schedules: [
        { type: 'garbage', frequency: 'fortnightly', dayOfWeek: 3 }, // invented frequency
        { type: 'compost', frequency: 'weekly', dayOfWeek: 3 }, // invented stream
        { type: 'garbage', frequency: 'weekly', dayOfWeek: 9 }, // impossible day
      ],
    });

    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [] })] },
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });
    // The third row survives normalisation as a weekly stream with no day, which
    // expands to nothing — so the honest outcome is Stage C, not a blank card.
    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
  });

  it('never shows a raw provider error', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(new Error(`401 invalid x-api-key ${LEAK_KEY}`));

    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ schedules: [] })] },
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });

    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
    expect(JSON.stringify(result)).not.toContain(LEAK_KEY);
    expect(JSON.stringify(result)).not.toContain('401');
  });

  it('does not wire Stage B at all when there is no schedule row', async () => {
    // No municipality means no key in the world helps, so `not_supported` — not
    // `no_key`, which would send the member to Settings to fix the wrong thing.
    const generate = jest.fn();
    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [] },
      today: MONDAY_EARLY,
      byok: keyedPort(generate),
    });

    expect(result).toEqual({ stage: 'C', reason: 'not_supported' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('treats a blank municipality the same as none', async () => {
    const result = await inferGarbageDay({
      ledger: { garbageSchedules: [schedule({ municipality: '   ', schedules: [] })] },
      today: MONDAY_EARLY,
      byok: keyedPort(jest.fn()),
    });
    expect(result).toEqual({ stage: 'C', reason: 'not_supported' });
  });
});

describe('garbage day — normalising what a model returns', () => {
  it('keeps a well-formed weekly stream', () => {
    expect(
      normalizeInferredStreams({ schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: 3 }] }),
    ).toEqual([{ type: 'garbage', frequency: 'weekly', dayOfWeek: 3 }]);
  });

  it('keeps the alternating-week marker', () => {
    expect(
      normalizeInferredStreams({
        schedules: [{ type: 'recycling', frequency: 'biweekly', dayOfWeek: 2, week: 'B' }],
      }),
    ).toEqual([{ type: 'recycling', frequency: 'biweekly', dayOfWeek: 2, week: 'B' }]);
  });

  it.each([
    ['an invented stream type', { type: 'compost', frequency: 'weekly', dayOfWeek: 3 }],
    ['an invented frequency', { type: 'garbage', frequency: 'fortnightly', dayOfWeek: 3 }],
    ['a missing type', { frequency: 'weekly', dayOfWeek: 3 }],
  ])('drops %s', (_label, item) => {
    expect(normalizeInferredStreams({ schedules: [item] })).toEqual([]);
  });

  it.each([-1, 7, 9, 1.5])('drops an impossible dayOfWeek (%s) but keeps the stream', (day) => {
    expect(
      normalizeInferredStreams({ schedules: [{ type: 'garbage', frequency: 'weekly', dayOfWeek: day }] }),
    ).toEqual([{ type: 'garbage', frequency: 'weekly' }]);
  });

  it('survives a null or empty answer', () => {
    expect(normalizeInferredStreams(null)).toEqual([]);
    expect(normalizeInferredStreams({})).toEqual([]);
  });
});

// ===========================================================================
// Home insight / maintenance suggestions
// ===========================================================================

describe('home insight — Stage A rules work offline with no key', () => {
  it('flags an overdue task as high priority', async () => {
    const result = await buildHomeInsights({
      ledger: { tasks: [task({ next_due_date: '2026-08-01' })] },
      today: TODAY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value).toEqual([
      {
        id: 'task_overdue:task-1',
        kind: 'task_overdue',
        title: 'Replace furnace filter',
        detail: 'Overdue by 12 days.',
        priority: 'high',
        source: 'rules',
        taskId: 'task-1',
      },
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('flags a task due inside the window and says how long', async () => {
    const result = await buildHomeInsights({
      ledger: {
        tasks: [
          task({ id: 'a', next_due_date: '2026-08-13' }),
          task({ id: 'b', next_due_date: '2026-08-20' }),
          task({ id: 'c', next_due_date: '2026-09-30' }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.map((i) => [i.id, i.detail])).toEqual([
      ['task_due_soon:a', 'Due today.'],
      ['task_due_soon:b', 'Due in 7 days.'],
    ]);
  });

  it('does not call a task due today overdue', async () => {
    // The timezone trap: `new Date('2026-08-13')` is UTC midnight, so on a
    // device in UTC-7 a task due today reads as overdue by seven hours.
    const result = await buildHomeInsights({
      ledger: { tasks: [task({ next_due_date: '2026-08-13' })] },
      today: new Date(2026, 7, 13, 23, 30, 0),
      byok: OFFLINE_PORT,
    });
    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value[0]!.kind).toBe('task_due_soon');
  });

  it('skips an inactive task even when it is overdue', async () => {
    const result = await buildHomeInsights({
      ledger: {
        tasks: [
          task({ id: 'off', next_due_date: '2026-01-01', is_active: false }),
          task({ id: 'on', next_due_date: '2026-01-01' }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });
    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.map((i) => i.taskId)).toEqual(['on']);
  });

  it('flags a warranty about to end, and ignores one that is a year away', async () => {
    const result = await buildHomeInsights({
      ledger: {
        appliances: [
          appliance({
            id: 'soon',
            name: 'Dishwasher',
            warranty: { manufacturer: { expiration: '2026-09-15', coverage: 'parts' } },
          }),
          appliance({
            id: 'later',
            name: 'Heat pump',
            warranty: { manufacturer: { expiration: '2028-01-01', coverage: 'parts' } },
          }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.applianceId).toBe('soon');
    expect(result.value[0]!.title).toBe('Dishwasher warranty ends soon');
    expect(result.value[0]!.detail).toBe(
      'The warranty ends in 33 days. Worth logging any outstanding faults now.',
    );
  });

  it('uses the EARLIEST of the manufacturer and extended warranties', async () => {
    const result = await buildHomeInsights({
      ledger: {
        appliances: [
          appliance({
            warranty: {
              extended: { provider: 'X', expiration: '2026-08-20', coverage: 'all' },
              manufacturer: { expiration: '2029-01-01', coverage: 'parts' },
            },
          }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });
    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value[0]!.detail).toContain('7 days');
  });

  it('judges service cadence from the member’s own history, not from a guess', async () => {
    const result = await buildHomeInsights({
      ledger: {
        appliances: [
          appliance({ id: 'stale', name: 'Furnace' }),
          appliance({ id: 'fresh', name: 'Boiler' }),
          // Never serviced: no rule fires. The tempting "older than a year"
          // rule fires on a toaster and teaches members to ignore the list.
          appliance({ id: 'never', name: 'Toaster', category: 'kitchen' }),
        ],
        applianceServiceHistory: [
          serviceEntry({ id: 's1', appliance_id: 'stale', service_date: '2025-01-05' }),
          serviceEntry({ id: 's2', appliance_id: 'fresh', service_date: '2026-06-01' }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.map((i) => i.applianceId)).toEqual(['stale']);
    expect(result.value[0]!.detail).toBe('Last serviced 585 days ago.');
  });

  it('uses the most recent service entry when there are several', async () => {
    const ledger = {
      appliances: [appliance()],
      applianceServiceHistory: [
        serviceEntry({ id: 's1', service_date: '2019-05-01' }),
        serviceEntry({ id: 's2', service_date: '2026-07-01' }),
      ],
    };
    // The stale 2019 entry would fire the rule if the newest were not used.
    expect(buildHomeInsightsStageA(ledger, TODAY)).toEqual([]);
    // Serviced six weeks ago and nothing else to say, so Stage A declines and
    // the ladder moves on rather than inventing a suggestion.
    const result = await buildHomeInsights({ ledger, today: TODAY, byok: NO_KEY_PORT });
    expect(result).toEqual({ stage: 'C', reason: 'no_key' });
  });

  it('flags an appliance past its expected life', async () => {
    const result = await buildHomeInsights({
      ledger: {
        appliances: [
          appliance({ id: 'old', install_date: '2010-05-01', expected_lifespan: 15 }),
          appliance({ id: 'young', install_date: '2024-05-01', expected_lifespan: 15 }),
        ],
      },
      today: TODAY,
      byok: OFFLINE_PORT,
    });

    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.map((i) => i.applianceId)).toEqual(['old']);
    expect(result.value[0]!.detail).toContain('passed its expected 15-year life');
  });

  it('stays quiet when there is no lifespan or no start date to project from', async () => {
    const result = await buildHomeInsights({
      ledger: {
        appliances: [
          appliance({ id: 'no-life', install_date: '2000-01-01' }),
          appliance({ id: 'no-date', expected_lifespan: 10 }),
        ],
      },
      today: TODAY,
      byok: NO_KEY_PORT,
    });
    expect(result).toEqual({ stage: 'C', reason: 'no_key' });
  });

  it('orders high before medium before low, deterministically', async () => {
    const ledger = {
      tasks: [
        task({ id: 'due', next_due_date: '2026-08-20' }),
        task({ id: 'late', next_due_date: '2026-08-01' }),
      ],
      appliances: [
        appliance({ id: 'old', install_date: '2000-01-01', expected_lifespan: 10 }),
        appliance({
          id: 'warranty',
          warranty: { manufacturer: { expiration: '2026-09-01', coverage: 'parts' } },
        }),
      ],
    };
    const first = await buildHomeInsights({ ledger, today: TODAY, byok: OFFLINE_PORT });
    const second = await buildHomeInsights({ ledger, today: TODAY, byok: OFFLINE_PORT });

    if (first.stage !== 'A' || second.stage !== 'A') throw new Error('expected Stage A');
    expect(first.value.map((i) => i.priority)).toEqual(['high', 'medium', 'medium', 'low']);
    // A list that re-keys or re-orders on every ledger bump loses scroll
    // position and animates like a glitch.
    expect(second.value).toEqual(first.value);
  });

  it('caps the list rather than rendering a ten-year backlog', async () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      task({ id: `t${String(i).padStart(2, '0')}`, next_due_date: '2026-01-01' }),
    );
    const result = await buildHomeInsights({ ledger: { tasks }, today: TODAY, byok: OFFLINE_PORT });
    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value).toHaveLength(MAX_HOME_INSIGHTS);
  });

  it('answers an empty home with an empty list, not a provider call', async () => {
    // `[]` means "nothing to report"; `null` means "I cannot tell". Collapsing
    // them sends every brand-new household to a paid provider on first launch.
    const result = await buildHomeInsights({ ledger: {}, today: TODAY, byok: OFFLINE_PORT });
    expect(result).toEqual({ stage: 'A', value: [] });
  });

  it('scopes to one property on a multi-property device', async () => {
    const result = await buildHomeInsights({
      ledger: {
        tasks: [
          task({ id: 'mine', household_id: 'hh-2', next_due_date: '2026-08-01' }),
          task({ id: 'theirs', household_id: 'hh-1', next_due_date: '2026-08-01' }),
        ],
      },
      householdId: 'hh-2',
      today: TODAY,
      byok: OFFLINE_PORT,
    });
    if (result.stage !== 'A') throw new Error('expected Stage A');
    expect(result.value.map((i) => i.taskId)).toEqual(['mine']);
  });

  it('the pure Stage A function needs nothing but rows and a date', () => {
    expect(
      buildHomeInsightsStageA({ tasks: [task({ next_due_date: '2026-08-01' })] }, TODAY),
    ).toHaveLength(1);
  });
});

describe('home insight — Stage B, and what it is allowed to send', () => {
  /** A home with plenty of rows and nothing mechanically wrong with it. */
  const quietHome = {
    tasks: [task({ next_due_date: '2027-06-01' })],
    appliances: [appliance()],
    applianceServiceHistory: [serviceEntry()],
    homeFeatures: [homeFeature()],
  };

  it('says so in the member’s language when there is no key', async () => {
    const result = await buildHomeInsights({
      ledger: quietHome,
      today: TODAY,
      byok: NO_KEY_PORT,
    });
    expect(result).toEqual({ stage: 'C', reason: 'no_key' });
  });

  it('sends allowlisted fields only — this is the payload, in full', async () => {
    const generate = jest.fn().mockResolvedValue({
      suggestions: [{ title: 'Clear the gutters', detail: 'Before the autumn rain.' }],
    });

    const result = await buildHomeInsights({
      ledger: quietHome,
      today: TODAY,
      byok: keyedPort(generate),
    });

    expect(result.stage).toBe('B');
    const { context } = requestSeenBy(generate);
    expect(context.tables.tasks).toEqual([
      {
        id: 'task-1',
        title: 'Replace furnace filter',
        system_category: 'hvac',
        frequency: 'monthly',
        next_due_date: '2027-06-01',
        is_active: true,
      },
    ]);
    expect(context.tables.appliances).toEqual([
      {
        id: 'app-1',
        name: 'Furnace',
        category: 'hvac',
        brand: 'Lennox',
        model: 'ML195',
      },
    ]);
    expect(context.tables.applianceServiceHistory).toEqual([
      { id: 'svc-1', appliance_id: 'app-1', service_date: '2026-06-01' },
    ]);
    expect(context.tables.homeFeatures).toEqual([{ id: 'hf-1', feature_type: 'roof' }]);
    expect(context.excludedTables).toEqual([]);
  });

  it('leaves behind the free text, the people and the serial numbers', async () => {
    const generate = jest.fn().mockResolvedValue({ suggestions: [{ title: 'x', detail: 'y' }] });
    await buildHomeInsights({ ledger: quietHome, today: TODAY, byok: keyedPort(generate) });

    const serialized = JSON.stringify(requestSeenBy(generate).context);
    expect(serialized).not.toContain('gate code 4792'); // task.description
    expect(serialized).not.toContain('Sam Delgado'); // task.assigned_to
    expect(serialized).not.toContain('user-9');
    expect(serialized).not.toContain('LX-88-114-2231'); // appliance.serial_number
    expect(serialized).not.toContain('6400'); // appliance.purchase_cost
    expect(serialized).not.toContain('Utility room'); // appliance.location
    expect(serialized).not.toContain('Ridgeline Heating'); // service provider
    expect(serialized).not.toContain('Mrs Delgado'); // homeFeature.notes
    expect(serialized).not.toContain('hh-1'); // the household correlator
  });

  it('redacts a phone number a member typed into an allowed field', async () => {
    const generate = jest.fn().mockResolvedValue({ suggestions: [{ title: 'x', detail: 'y' }] });
    await buildHomeInsights({
      ledger: {
        ...quietHome,
        tasks: [task({ title: 'Call the roofer on 604-555-0142', next_due_date: '2027-06-01' })],
      },
      today: TODAY,
      byok: keyedPort(generate),
    });

    const serialized = JSON.stringify(requestSeenBy(generate).context);
    expect(serialized).not.toContain('604-555-0142');
    expect(serialized).toContain('[redacted]');
  });

  it('maps the assistant’s answer into the same shape the rules produce', async () => {
    const generate = jest.fn().mockResolvedValue({
      suggestions: [
        { title: 'Clear the gutters', detail: 'Before the autumn rain.', priority: 'high' },
        { title: 'Bleed the radiators', detail: '' },
      ],
    });

    const result = await buildHomeInsights({
      ledger: quietHome,
      today: TODAY,
      byok: keyedPort(generate),
    });

    if (result.stage !== 'B') throw new Error('expected Stage B');
    expect(result.value).toEqual([
      {
        id: 'assistant_suggestion:0:clear-the-gutters',
        kind: 'assistant_suggestion',
        title: 'Clear the gutters',
        detail: 'Before the autumn rain.',
        priority: 'high',
        source: 'assistant',
      },
      {
        id: 'assistant_suggestion:1:bleed-the-radiators',
        kind: 'assistant_suggestion',
        title: 'Bleed the radiators',
        detail: '',
        priority: 'medium',
        source: 'assistant',
      },
    ]);
  });

  it('falls to Stage C when the assistant returns nothing usable', async () => {
    const generate = jest.fn().mockResolvedValue({ suggestions: [{ detail: 'no title' }] });
    const result = await buildHomeInsights({
      ledger: quietHome,
      today: TODAY,
      byok: keyedPort(generate),
    });
    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
  });

  it('never shows a raw provider error', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(new Error(`500 upstream said ${LEAK_KEY} is revoked`));

    const result = await buildHomeInsights({
      ledger: quietHome,
      today: TODAY,
      byok: keyedPort(generate),
    });

    expect(result).toEqual({ stage: 'C', reason: 'provider_failed' });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(LEAK_KEY);
    expect(serialized).not.toContain('500');
    expect(serialized).not.toContain('revoked');
  });
});

describe('what a screen renders for a Stage C result', () => {
  /**
   * The last link in the DoD's *"Stage C copy shown, never a raw error"*: the
   * ladder returns a `reason`, and a screen turns that into words. Proving the
   * reason is right and stopping there would leave the actual member-visible
   * step untested.
   */
  async function stageCFrom(byok: HouseByokPort) {
    const result = await buildHomeInsights({
      ledger: { tasks: [task({ next_due_date: '2027-06-01' })] },
      today: TODAY,
      byok,
    });
    if (result.stage !== 'C') throw new Error(`expected Stage C, got ${result.stage}`);
    return houseAiUnavailable(result.reason);
  }

  it('renders "add a key" copy, with no identifier in it', async () => {
    const error = await stageCFrom(NO_KEY_PORT);
    expect(error).toBeInstanceOf(HouseAiUnavailableError);
    expect(error.message).toBe(getHouseAiUnavailableCopy('no_key').message);
    expect(error.message).not.toContain('no_key');
    expect(error.message).not.toMatch(/[a-z]+_[a-z]+/);
  });

  it('renders "your provider did not answer" copy, never the provider’s words', async () => {
    const generate = jest.fn().mockRejectedValue(new Error(`403 forbidden ${LEAK_KEY}`));
    const error = await stageCFrom(keyedPort(generate));
    expect(error.message).toBe(getHouseAiUnavailableCopy('provider_failed').message);
    expect(error.message).not.toContain(LEAK_KEY);
    expect(error.message).not.toContain('403');
    expect(error.message).not.toContain('forbidden');
  });
});

describe('home insight — normalising what a model returns', () => {
  it('drops a suggestion with no title rather than rendering an empty card', () => {
    expect(
      normalizeAssistantInsights({ suggestions: [{ title: '   ', detail: 'x' }, { detail: 'y' }] }),
    ).toEqual([]);
  });

  it('defaults an unknown priority to medium', () => {
    const [insight] = normalizeAssistantInsights({
      suggestions: [{ title: 'Do a thing', detail: '', priority: 'urgent' }],
    });
    expect(insight!.priority).toBe('medium');
  });

  it('gives colliding titles distinct ids', () => {
    const insights = normalizeAssistantInsights({
      suggestions: [
        { title: 'Clear the gutters', detail: 'front' },
        { title: 'Clear the gutters', detail: 'back' },
      ],
    });
    expect(new Set(insights.map((i) => i.id)).size).toBe(2);
  });

  it('caps a runaway answer', () => {
    const suggestions = Array.from({ length: 40 }, (_, i) => ({ title: `Thing ${i}`, detail: '' }));
    expect(normalizeAssistantInsights({ suggestions })).toHaveLength(MAX_HOME_INSIGHTS);
  });

  it('survives a null or empty answer', () => {
    expect(normalizeAssistantInsights(null)).toEqual([]);
    expect(normalizeAssistantInsights({})).toEqual([]);
  });
});
