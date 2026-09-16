import {
  clearAllE2ETestLogs,
  dumpE2ETestObservabilityToConsole,
  findE2ENetworkEntryBySpec,
  findE2EPersistEntryBySpec,
  getE2EActiveMatrixTag,
  getE2EPersistLog,
  getE2ENetworkLog,
  getE2ER2UploadLog,
  getE2EUiLog,
  getE2EWsLog,
  recordE2ENetworkEntry,
  recordE2EPersistEntry,
  recordE2ER2UploadEntry,
  recordE2EUiEvent,
  recordE2EWsEvent,
  setE2EActiveMatrixTag,
} from '../e2eTestObservability';

describe('e2eTestObservability', () => {
  beforeEach(() => {
    clearAllE2ETestLogs();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('records network entries and strips query strings in __DEV__', () => {
    recordE2ENetworkEntry({
      method: 'post',
      url: '/households/h1/budget/items?foo=1',
      status: 201,
      ok: true,
    });
    const log = getE2ENetworkLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.url).toBe('/households/h1/budget/items');
    expect(log[0]?.method).toBe('POST');
    expect(log[0]?.ok).toBe(true);
  });

  it('tags subsequent entries with active matrix row', () => {
    setE2EActiveMatrixTag('BUDGET-SAVE-003');
    recordE2ENetworkEntry({ method: 'GET', url: '/budget/savings', status: 200, ok: true });
    recordE2EPersistEntry({
      store: '@budget/savings',
      operation: 'read',
      detail: 'count=3',
    });
    recordE2EUiEvent({ action: 'tap', testId: 'save-button', screen: 'Savings' });

    expect(getE2ENetworkLog()[0]?.matrixId).toBe('BUDGET-SAVE-003');
    expect(getE2EPersistLog()[0]?.matrixId).toBe('BUDGET-SAVE-003');
    expect(getE2EUiLog()[0]?.matrixId).toBe('BUDGET-SAVE-003');
    expect(getE2EActiveMatrixTag()).toBe('BUDGET-SAVE-003');
  });

  it('finds network entries by matrix spec', () => {
    recordE2ENetworkEntry({ method: 'POST', url: '/tasks', status: 201, ok: true });
    recordE2ENetworkEntry({ method: 'GET', url: '/tasks', status: 200, ok: true });
    const hit = findE2ENetworkEntryBySpec({
      method: 'POST',
      urlIncludes: '/tasks',
      status: 201,
    });
    expect(hit?.method).toBe('POST');
    expect(hit?.status).toBe(201);
  });

  it('exact match on urlIncludes does not match nested sub-resources sharing the prefix', () => {
    recordE2ENetworkEntry({
      method: 'GET',
      url: '/households/abc123/join-requests',
      status: 401,
      ok: false,
    });
    const looseHit = findE2ENetworkEntryBySpec({ method: 'GET', urlIncludes: '/households' });
    expect(looseHit).toBeDefined(); // substring match still finds the nested call

    const exactHit = findE2ENetworkEntryBySpec({
      method: 'GET',
      urlIncludes: '/households',
      exact: true,
    });
    expect(exactHit).toBeUndefined(); // exact match correctly excludes it
  });

  it('exact match on urlIncludes matches the bare route itself', () => {
    recordE2ENetworkEntry({ method: 'GET', url: '/households', status: 401, ok: false });
    const hit = findE2ENetworkEntryBySpec({
      method: 'GET',
      urlIncludes: '/households',
      exact: true,
      status: 401,
    });
    expect(hit?.url).toBe('/households');
  });

  it('finds persist entries by matrix spec', () => {
    recordE2EPersistEntry({ store: 'kaizen_sqlite', operation: 'sync', detail: 'dirty_tables=1' });
    recordE2EPersistEntry({
      store: 'kaizen_weekly_rotations',
      operation: 'upsert',
      detail: 'weekday=1',
    });
    const hit = findE2EPersistEntryBySpec({
      store: 'kaizen_weekly_rotations',
      operation: 'upsert',
    });
    expect(hit?.store).toBe('kaizen_weekly_rotations');
    expect(hit?.detail).toBe('weekday=1');
  });

  it('matches persist entries on a store substring, like network URLs', () => {
    recordE2EPersistEntry({ store: 'health.weightLog.v1', operation: 'update', detail: 'insert' });
    expect(findE2EPersistEntryBySpec({ store: 'weightLog' })?.store).toBe('health.weightLog.v1');
  });

  it('filters persist matches on detailIncludes when given', () => {
    recordE2EPersistEntry({ store: 'health.notes.v1', operation: 'upsert', detail: 'len=12' });
    expect(
      findE2EPersistEntryBySpec({ store: 'health.notes.v1', detailIncludes: 'len=99' }),
    ).toBeUndefined();
    expect(
      findE2EPersistEntryBySpec({ store: 'health.notes.v1', detailIncludes: 'len=12' })?.detail,
    ).toBe('len=12');
  });

  it('records persist entries', () => {
    recordE2EPersistEntry({
      store: '@health/weight',
      operation: 'insert',
      detail: 'weight=180lb',
    });
    expect(getE2EPersistLog()).toHaveLength(1);
    expect(getE2EPersistLog()[0]?.operation).toBe('insert');
    expect(getE2EPersistLog()[0]?.store).toBe('@health/weight');
    expect(getE2EPersistLog()[0]?.detail).toBe('weight=180lb');
  });

  it('records ui events', () => {
    recordE2EUiEvent({
      action: 'tap',
      testId: 'task-complete',
      screen: 'Today',
    });
    const log = getE2EUiLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.action).toBe('tap');
    expect(log[0]?.testId).toBe('task-complete');
    expect(log[0]?.screen).toBe('Today');
  });

  it('clears all buffers and active matrix tag', () => {
    setE2EActiveMatrixTag('HOUSE-TASK-002');
    recordE2ENetworkEntry({ method: 'GET', url: '/tasks', status: 200, ok: true });
    recordE2EPersistEntry({
      store: '@kaizen/habits',
      operation: 'sync',
      detail: 'pushed=2',
    });
    recordE2EUiEvent({ action: 'scroll', screen: 'Systems' });

    clearAllE2ETestLogs();

    expect(getE2ENetworkLog()).toHaveLength(0);
    expect(getE2EPersistLog()).toHaveLength(0);
    expect(getE2EUiLog()).toHaveLength(0);
    expect(getE2EActiveMatrixTag()).toBeUndefined();
  });

  it('dump does not throw and logs snapshot lines', () => {
    recordE2ENetworkEntry({
      method: 'GET',
      url: '/ping',
      status: 200,
      ok: true,
      detail: 'count=5',
    });
    recordE2EPersistEntry({
      store: '@health/weight',
      operation: 'read',
      detail: 'latest',
    });

    expect(() => dumpE2ETestObservabilityToConsole()).not.toThrow();

    const lines = (console.log as jest.Mock).mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes('[E2E-DUMP]'))).toBe(true);
    expect(lines.some((line) => line.includes('observability snapshot start'))).toBe(true);
    expect(lines.some((line) => line.includes('detail=count=5'))).toBe(true);
    expect(lines.some((line) => line.includes('observability snapshot end'))).toBe(true);
  });

  it('records R2 upload entries with redacted target', () => {
    recordE2ER2UploadEntry({
      uploadUrl: 'https://bucket.r2.cloudflarestorage.com/path/to/key?X-Amz-Signature=secret',
      status: 200,
      ok: true,
      label: 'report',
      detail: 'hasReportId',
    });
    const entry = getE2ER2UploadLog()[0];
    expect(entry?.uploadTarget).not.toContain('Signature');
    expect(entry?.label).toBe('report');
  });

  it('records WebSocket lifecycle events', () => {
    recordE2EWsEvent({
      action: 'message',
      channel: 'house-chat',
      path: '/households/h1/chat-rooms/r1/ws',
      detail: 'type=message',
    });
    expect(getE2EWsLog()[0]?.channel).toBe('house-chat');
    expect(getE2EWsLog()[0]?.action).toBe('message');
  });
});
