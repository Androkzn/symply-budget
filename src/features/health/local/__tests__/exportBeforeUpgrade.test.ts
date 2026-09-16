/**
 * He3a Exit — export-before-upgrade reads D1 with `X-Health-Local-First`
 * ABSENT (plan §1.3a, §12.1).
 *
 * The named test in the plan is exactly this one, and the failure it guards is
 * not a crash — it is an export that succeeds and contains nothing:
 *
 * > an engineer who wires it through the new `healthApi` gets an export of the
 * > **empty local ledger**: the one artefact that makes data loss survivable
 * > produces zero rows, and nobody notices because it "works".
 *
 * So the assertions below are deliberately about PLUMBING rather than output
 * shape. A test that only checked "the CSV has rows" would pass against a
 * fixture no matter which system answered it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  HEALTH_DATA_CONTINUITY_COPY,
  HEALTH_WAVE_A_EXPORT_BUCKETS,
  HealthExportWindowClosedError,
  exportHealthBeforeUpgrade,
} from '../exportBeforeUpgrade';
import {
  armHealthLocalFirstHeader,
  disarmHealthLocalFirstHeader,
  isHealthLocalFirstHeaderArmed,
} from '../sync/headers';

jest.mock('@api/client', () => {
  const get = jest.fn();
  const post = jest.fn();
  const put = jest.fn();
  const del = jest.fn();
  return {
    __esModule: true,
    apiClient: { get, post, put, delete: del },
    api: {},
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiClient } = require('@api/client') as {
  apiClient: { get: jest.Mock; post: jest.Mock; put: jest.Mock; delete: jest.Mock };
};

const DELTA = {
  server_time: '2026-08-14T00:00:00.000Z',
  weight_entries: [
    { id: 'w1', date: '2026-08-01', weight: 81.2, unit: 'kg', note: null, deleted_at: null },
    { id: 'w2', date: '2026-08-02', weight: 80.9, unit: 'kg', note: 'after, run', deleted_at: null },
    { id: 'w3', date: '2026-08-03', weight: 80.0, unit: 'kg', deleted_at: '2026-08-04T00:00:00Z' },
  ],
  water_entries: [{ id: 'h1', date: '2026-08-01', amount_ml: 250, beverage_type: 'water' }],
  habits: [{ id: 'hab1', name: 'Walk' }],
  // Wave C — present in the delta, deliberately NOT in the file.
  period_entries: [{ id: 'p1', date: '2026-08-01' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  disarmHealthLocalFirstHeader();
  apiClient.get.mockResolvedValue({ data: DELTA });
});

afterEach(() => {
  disarmHealthLocalFirstHeader();
});

describe('export-before-upgrade — the header must be absent', () => {
  it('reads D1 and sends no X-Health-Local-First header', async () => {
    await exportHealthBeforeUpgrade();

    expect(apiClient.get).toHaveBeenCalledTimes(1);
    const [url, config] = apiClient.get.mock.calls[0] as [string, Record<string, unknown>];

    expect(url).toBe('/health/sync');
    // The header must not be set explicitly by the export path...
    const headers = (config?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers)).not.toContain('X-Health-Local-First');
    // ...and the arming flag the interceptor reads must still be off.
    expect(isHealthLocalFirstHeaderArmed()).toBe(false);
  });

  it('refuses once the header is armed, rather than exporting an empty ledger', async () => {
    armHealthLocalFirstHeader();

    await expect(exportHealthBeforeUpgrade()).rejects.toBeInstanceOf(HealthExportWindowClosedError);
    // The refusal must come BEFORE the network call — an armed read would 410.
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('goes to the server even when a local ledger exists', async () => {
    // The regression this guards: someone "simplifies" the import to `healthApi`.
    const source = readFileSync(join(__dirname, '..', 'exportBeforeUpgrade.ts'), 'utf8');
    // ONE pass, alternation ordered so whichever delimiter appears FIRST wins.
    // Block-then-line ordering lets a `/*` inside a line comment open a phantom
    // block and delete real code, which would make this assertion vacuous.
    const code = source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_match, before) =>
      before === undefined ? ' ' : `${before} `,
    );
    expect(code).toContain('remoteHealthApi.sync(');
    expect(code).not.toMatch(/\bhealthApi\.sync\(/);
  });
});

describe('CSV contents', () => {
  it('covers the eight Wave A buckets and excludes Wave C', async () => {
    const { csv } = await exportHealthBeforeUpgrade();

    expect(HEALTH_WAVE_A_EXPORT_BUCKETS).toHaveLength(8);
    for (const bucket of HEALTH_WAVE_A_EXPORT_BUCKETS) {
      expect(csv).toContain(`# ${bucket} (`);
    }
    // Wave C stays server-authoritative across the cutover — not at risk, not exported.
    expect(csv).not.toContain('period_entries');
  });

  it('drops tombstoned rows and counts only live ones', async () => {
    const { csv, rows } = await exportHealthBeforeUpgrade();

    expect(csv).toContain('# weight_entries (2 rows)');
    expect(csv).not.toContain('w3');
    // 2 weight + 1 water + 1 habit
    expect(rows).toBe(4);
  });

  it('quotes cells containing commas so the file parses', async () => {
    const { csv } = await exportHealthBeforeUpgrade();
    expect(csv).toContain('"after, run"');
  });

  it('distinguishes an empty bucket from a missing one', async () => {
    const { csv } = await exportHealthBeforeUpgrade();
    // The delta carried no body_measurements at all; the file still says so.
    expect(csv).toContain('# body_measurements (0 rows)');
    expect(csv).toContain('(no rows)');
  });

  it('carries the verbatim first-launch continuity copy', async () => {
    expect(HEALTH_DATA_CONTINUITY_COPY).toBe(
      'Symply Health now stores your data on this device. ' +
        'Entries made before this update are not carried over.',
    );
  });
});
