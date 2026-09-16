/**
 * watchSyncService — the legacy `WatchBridge` NativeModule wrapper.
 *
 * Matrix: BUDGET-WATCH-008 (degrades safely when the bridge is unlinked) and
 * BUDGET-WATCH-009 (the task-completion listener does not leak across a
 * remount). `src/services/watch-sync.ts` had zero tests before 2026-07-20
 * (PLAT-WIDGET-005), so the happy path is covered here too — otherwise the
 * failure-mode rows would be the only thing exercising the file.
 *
 * `watch-sync.ts` destructures `NativeModules.WatchBridge` at module scope, so
 * every scenario re-requires the module through `loadService()` after flipping
 * the mock state.
 */

type Handler = (event: unknown) => void;

let mockPlatformOS: 'ios' | 'android' = 'ios';
let mockWatchBridge: Record<string, jest.Mock> | undefined;
let mockListeners: Record<string, Handler[]> = {};
let mockEmitterArgs: unknown[] = [];

jest.mock('react-native', () => ({
  get Platform() {
    return { OS: mockPlatformOS };
  },
  get NativeModules() {
    return { WatchBridge: mockWatchBridge };
  },
  NativeEventEmitter: class MockNativeEventEmitter {
    constructor(nativeModule?: unknown) {
      mockEmitterArgs.push(nativeModule);
    }

    addListener(event: string, handler: Handler) {
      if (!mockListeners[event]) mockListeners[event] = [];
      mockListeners[event].push(handler);
      return {
        remove: () => {
          mockListeners[event] = (mockListeners[event] || []).filter((h) => h !== handler);
        },
      };
    }

    removeAllListeners(event: string) {
      delete mockListeners[event];
    }
  },
}));

/** Emit a native event to whatever handlers are currently subscribed. */
function emit(event: string, payload: unknown = {}): void {
  (mockListeners[event] || []).forEach((handler) => handler(payload));
}

function listenerCount(event: string): number {
  return (mockListeners[event] || []).length;
}

function makeBridge(): Record<string, jest.Mock> {
  return {
    syncAuthTokens: jest.fn(),
    syncTasksToWatch: jest.fn(),
    syncBriefing: jest.fn(),
    setApiBaseUrl: jest.fn(),
    syncHomeInsight: jest.fn(),
    syncWidgetTasks: jest.fn(),
    reloadWidgets: jest.fn(),
    clearWatchData: jest.fn(),
    isWatchReachable: jest.fn().mockResolvedValue({
      supported: true,
      paired: true,
      watchAppInstalled: true,
      reachable: true,
    }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadService(): any {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../watch-sync').watchSyncService;
}

/** Every public method, called with plausible arguments. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callEveryMethod(service: any): Promise<void> {
  service.initialize();
  service.isAvailable();
  await service.syncAuthTokens('token', 'hh_1', 'u_1');
  await service.syncTasks([{ id: 't1' }]);
  await service.syncBriefing('Replace the HVAC filter.', '2026-07-20');
  await service.setApiBaseUrl('https://api.example.test');
  await service.syncHomeInsight({ id: 'i1' });
  await service.syncWidgetTasks([{ id: 't1' }]);
  await service.reloadWidgets();
  await service.clearWatchData();
  await service.getWatchStatus();
  service.cleanup();
}

describe('watchSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockWatchBridge = undefined;
    mockListeners = {};
    mockEmitterArgs = [];
  });

  describe('BUDGET-WATCH-008 — bridge degrades safely', () => {
    it('BUDGET-WATCH-008: every method is a no-op and does not throw when WatchBridge is unlinked', async () => {
      mockWatchBridge = undefined; // NativeModules.WatchBridge resolves undefined (Jest / bridgeless)
      const service = loadService();

      expect(service.isAvailable()).toBe(false);
      await expect(callEveryMethod(service)).resolves.toBeUndefined();
      // Nothing subscribed — initialize() bailed before constructing the emitter.
      expect(mockEmitterArgs).toHaveLength(0);
      expect(listenerCount('onWatchTaskCompleted')).toBe(0);
    });

    it('BUDGET-WATCH-008: isSupported is false off iOS even when the bridge is present', async () => {
      mockPlatformOS = 'android';
      mockWatchBridge = makeBridge();
      const service = loadService();

      expect(service.isAvailable()).toBe(false);
      await expect(service.getWatchStatus()).resolves.toEqual({ supported: false });

      await callEveryMethod(service);
      Object.values(mockWatchBridge).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('BUDGET-WATCH-008: getWatchStatus reports unsupported rather than rejecting when unlinked', async () => {
      mockWatchBridge = undefined;
      const service = loadService();

      await expect(service.getWatchStatus()).resolves.toEqual({ supported: false });
    });

    it('BUDGET-WATCH-008: a throwing native bridge is swallowed, not propagated', async () => {
      mockWatchBridge = makeBridge();
      const boom = new Error('WCSession not activated');
      Object.entries(mockWatchBridge).forEach(([name, fn]) => {
        if (name !== 'isWatchReachable') fn.mockImplementation(() => { throw boom; });
      });
      mockWatchBridge.isWatchReachable.mockRejectedValue(boom);
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const service = loadService();

      await expect(service.syncAuthTokens('t', 'hh', 'u')).resolves.toBeUndefined();
      await expect(service.syncTasks([{ id: 't1' }])).resolves.toBeUndefined();
      await expect(service.syncBriefing('p', '2026-07-20')).resolves.toBeUndefined();
      await expect(service.setApiBaseUrl('https://api.example.test')).resolves.toBeUndefined();
      await expect(service.syncHomeInsight({ id: 'i' })).resolves.toBeUndefined();
      await expect(service.syncWidgetTasks([{ id: 't' }])).resolves.toBeUndefined();
      await expect(service.reloadWidgets()).resolves.toBeUndefined();
      await expect(service.clearWatchData()).resolves.toBeUndefined();
      // A rejected reachability probe falls back to the unsupported shape.
      await expect(service.getWatchStatus()).resolves.toEqual({ supported: false });

      errorSpy.mockRestore();
    });
  });

  describe('BUDGET-WATCH-009 — listener lifecycle', () => {
    it('BUDGET-WATCH-009: cleanup() removes the onWatchTaskCompleted listener so later events are not handled', () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      service.initialize();
      expect(listenerCount('onWatchTaskCompleted')).toBe(1);
      expect(listenerCount('onWatchSyncRequested')).toBe(1);

      // Prove the subscription is live before tearing it down.
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      emit('onWatchTaskCompleted', { taskId: 'task_1' });
      expect(logSpy).toHaveBeenCalledWith('[WatchSync] Task completed on watch:', 'task_1');

      logSpy.mockClear();
      service.cleanup();
      expect(listenerCount('onWatchTaskCompleted')).toBe(0);
      expect(listenerCount('onWatchSyncRequested')).toBe(0);

      // Emitting after teardown must reach nobody.
      emit('onWatchTaskCompleted', { taskId: 'task_2' });
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    it('BUDGET-WATCH-009: a remount cycle leaves exactly one listener — completions are not double-handled', () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      service.initialize();
      service.cleanup();
      service.initialize();

      expect(listenerCount('onWatchTaskCompleted')).toBe(1);

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      emit('onWatchTaskCompleted', { taskId: 'task_3' });
      const completionLogs = logSpy.mock.calls.filter(
        (call) => call[0] === '[WatchSync] Task completed on watch:'
      );
      expect(completionLogs).toHaveLength(1);
      logSpy.mockRestore();

      service.cleanup();
    });

    it('BUDGET-WATCH-009: repeated initialize() without cleanup does not stack duplicate listeners', () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      service.initialize();
      service.initialize();
      service.initialize();

      expect(listenerCount('onWatchTaskCompleted')).toBe(1);
      expect(mockEmitterArgs).toHaveLength(1);

      service.cleanup();
    });
  });

  describe('happy path with a linked WatchBridge (PLAT-WIDGET-005 coverage)', () => {
    it('initialize() builds the emitter from the WatchBridge module and subscribes to both events', () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      expect(service.isAvailable()).toBe(true);
      service.initialize();

      expect(mockEmitterArgs).toEqual([mockWatchBridge]);
      expect(Object.keys(mockListeners).sort()).toEqual([
        'onWatchSyncRequested',
        'onWatchTaskCompleted',
      ]);

      service.cleanup();
    });

    it('forwards each call to the native bridge with the expected arguments', async () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      await service.syncAuthTokens('tok', 'hh_1', 'u_1');
      expect(mockWatchBridge.syncAuthTokens).toHaveBeenCalledWith('tok', 'hh_1', 'u_1');

      await service.syncTasks([{ id: 't1' }, { id: 't2' }]);
      expect(mockWatchBridge.syncTasksToWatch).toHaveBeenCalledWith(
        JSON.stringify([{ id: 't1' }, { id: 't2' }])
      );

      await service.syncBriefing('Replace the HVAC filter.', '2026-07-20');
      expect(mockWatchBridge.syncBriefing).toHaveBeenCalledWith(
        'Replace the HVAC filter.',
        '2026-07-20'
      );

      await service.setApiBaseUrl('https://api.example.test');
      expect(mockWatchBridge.setApiBaseUrl).toHaveBeenCalledWith('https://api.example.test');

      await service.syncHomeInsight({ id: 'i1' });
      expect(mockWatchBridge.syncHomeInsight).toHaveBeenCalledWith(JSON.stringify({ id: 'i1' }));

      await service.syncWidgetTasks([{ id: 't1' }]);
      expect(mockWatchBridge.syncWidgetTasks).toHaveBeenCalledWith(JSON.stringify([{ id: 't1' }]));

      await service.reloadWidgets();
      expect(mockWatchBridge.reloadWidgets).toHaveBeenCalled();

      await service.clearWatchData();
      expect(mockWatchBridge.clearWatchData).toHaveBeenCalled();

      await expect(service.getWatchStatus()).resolves.toEqual({
        supported: true,
        paired: true,
        watchAppInstalled: true,
        reachable: true,
      });
    });

    it('skips empty payloads before touching the bridge', async () => {
      mockWatchBridge = makeBridge();
      const service = loadService();

      await service.syncBriefing('', '2026-07-20');
      await service.syncBriefing('paragraph', '');
      expect(mockWatchBridge.syncBriefing).not.toHaveBeenCalled();

      await service.setApiBaseUrl('');
      expect(mockWatchBridge.setApiBaseUrl).not.toHaveBeenCalled();

      await service.syncHomeInsight(null);
      expect(mockWatchBridge.syncHomeInsight).not.toHaveBeenCalled();

      await service.syncWidgetTasks(null);
      expect(mockWatchBridge.syncWidgetTasks).not.toHaveBeenCalled();
    });
  });
});
