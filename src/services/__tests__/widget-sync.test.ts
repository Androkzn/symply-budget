/**
 * widgetSync — never forwards product JWT; companion + ids only.
 */
import fs from 'fs';
import path from 'path';

const mockSetAuth = jest.fn();
const mockSetCompanionAuth = jest.fn();
const mockClear = jest.fn();
const mockSetApiBaseUrl = jest.fn();
const mockSetSnapshot = jest.fn();
const mockSetHomeInsight = jest.fn();
const mockSetTasks = jest.fn();
const mockReload = jest.fn();

/**
 * Flips the native module between "linked" (an iOS build with the widget
 * extension) and "unlinked" (Android / Jest / Expo Go, where
 * `requireOptionalNativeModule` resolves null). `widget-sync.ts` captures the
 * module at import time, so a change here only takes effect after
 * `jest.resetModules()` + a fresh `require` — see `loadWidgetSync()`.
 *
 * Default-false on purpose: `jest.mock` is hoisted above this declaration, so
 * the top-level `import` below reads the flag before it is initialised. Only
 * `false`/`undefined` (= linked) is safe as the pre-init value.
 */
let mockNativeUnlinked = false;

jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core') as Record<string, unknown>;
  return {
    ...actual,
    requireOptionalNativeModule: () =>
      mockNativeUnlinked
        ? null
        : {
            setAuth: (...args: unknown[]) => mockSetAuth(...args),
            setCompanionAuth: (...args: unknown[]) => mockSetCompanionAuth(...args),
            setApiBaseUrl: (...args: unknown[]) => mockSetApiBaseUrl(...args),
            setHomeInsight: (...args: unknown[]) => mockSetHomeInsight(...args),
            setTasks: (...args: unknown[]) => mockSetTasks(...args),
            setSnapshot: (...args: unknown[]) => mockSetSnapshot(...args),
            clear: (...args: unknown[]) => mockClear(...args),
            reload: (...args: unknown[]) => mockReload(...args),
          },
  };
});

import { widgetSync } from '../widget-sync';

/** Re-import `widget-sync` against the current `mockNativeLinked` value. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadWidgetSync(linked: boolean): any {
  mockNativeUnlinked = !linked;
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../widget-sync').widgetSync;
  mockNativeUnlinked = false;
  return mod;
}

describe('widgetSync Data Bridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeUnlinked = false;
  });

  it('isAvailable when native module linked', () => {
    expect(widgetSync.isAvailable()).toBe(true);
  });

  it('setAuth requires householdId + userId (no JWT arg)', () => {
    widgetSync.setAuth('', 'u1');
    widgetSync.setAuth('hh', '');
    expect(mockSetAuth).not.toHaveBeenCalled();

    widgetSync.setAuth('hh_1', 'u_1');
    expect(mockSetAuth).toHaveBeenCalledWith('hh_1', 'u_1');
    expect(mockSetAuth.mock.calls[0]).toHaveLength(2);
  });

  it('setCompanionAuth skips empty tokens', () => {
    widgetSync.setCompanionAuth('');
    expect(mockSetCompanionAuth).not.toHaveBeenCalled();
    widgetSync.setCompanionAuth('companion.jwt');
    expect(mockSetCompanionAuth).toHaveBeenCalledWith('companion.jwt');
  });

  it('clear wipes App Group state', () => {
    widgetSync.clear();
    expect(mockClear).toHaveBeenCalled();
  });

  it('setSnapshot requires key + data', () => {
    widgetSync.setSnapshot('', { a: 1 });
    widgetSync.setSnapshot('widget_budget_summary', null as never);
    expect(mockSetSnapshot).not.toHaveBeenCalled();
    widgetSync.setSnapshot('widget_budget_summary', { total: 1 });
    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_budget_summary',
      JSON.stringify({ total: 1 })
    );
  });

  describe('BUDGET-WIDGET-006 — safe off iOS', () => {
    it('BUDGET-WIDGET-006: setSnapshot is a no-op and does not throw when the native module is unlinked', () => {
      const unlinked = loadWidgetSync(false);

      expect(unlinked.isAvailable()).toBe(false);
      expect(() =>
        unlinked.setSnapshot('widget_budget_summary', {
          remaining_cents: 123456,
          spent_cents: 4321,
          budget_cents: 200000,
          period_label: 'July 2026',
        })
      ).not.toThrow();
      expect(() => unlinked.setSnapshot('watch_budget_today', { remaining: 1234.56 })).not.toThrow();
      expect(mockSetSnapshot).not.toHaveBeenCalled();
    });

    it('BUDGET-WIDGET-006: every widgetSync method degrades to a no-op when unlinked', () => {
      const unlinked = loadWidgetSync(false);

      expect(() => {
        unlinked.setAuth('hh_1', 'u_1');
        unlinked.setCompanionAuth('companion.jwt');
        unlinked.setApiBaseUrl('https://api.example.test');
        unlinked.setHomeInsight({ id: 'i1' });
        unlinked.setTasks([{ id: 't1' }]);
        unlinked.setSnapshot('widget_budget_summary', { total: 1 });
        unlinked.clear();
        unlinked.reload();
      }).not.toThrow();

      [
        mockSetAuth,
        mockSetCompanionAuth,
        mockSetApiBaseUrl,
        mockSetHomeInsight,
        mockSetTasks,
        mockSetSnapshot,
        mockClear,
        mockReload,
      ].forEach((fn) => expect(fn).not.toHaveBeenCalled());
    });

    it('BUDGET-WIDGET-006: a throwing native module is swallowed by safe()', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockSetSnapshot.mockImplementationOnce(() => {
        throw new Error('App Group unavailable');
      });

      expect(() => widgetSync.setSnapshot('widget_budget_summary', { total: 1 })).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('BUDGET-WIDGET-009 — snapshot write triggers a widget reload', () => {
    it('BUDGET-WIDGET-009: setSnapshot reaches the native module that owns the reload', () => {
      widgetSync.setSnapshot('widget_budget_summary', { remaining_cents: 123456 });

      expect(mockSetSnapshot).toHaveBeenCalledTimes(1);
      expect(mockSetSnapshot).toHaveBeenCalledWith(
        'widget_budget_summary',
        JSON.stringify({ remaining_cents: 123456 })
      );
    });

    it('BUDGET-WIDGET-009: the native setSnapshot body calls reloadHomeWidget()', () => {
      // The reload itself lives in Swift (`WidgetCenter.shared.reloadAllTimelines()`),
      // so the JS layer can only assert the call reaches the module. This guards the
      // other half: that the module's `setSnapshot` still reloads the timeline
      // rather than leaving the widget on the system's next slot.
      const swift = fs.readFileSync(
        path.resolve(__dirname, '../../..', 'modules/widget-sync/ios/WidgetSyncModule.swift'),
        'utf8'
      );

      const body = swift.match(/Function\("setSnapshot"\)[\s\S]*?\n {4}\}/);
      expect(body).not.toBeNull();
      expect(body![0]).toContain('reloadHomeWidget()');
      expect(swift).toMatch(/func reloadHomeWidget\(\)\s*\{[\s\S]*?reloadAllTimelines\(\)/);
    });

    it('BUDGET-WIDGET-009: reload() forces a timeline refresh on demand', () => {
      widgetSync.reload();
      expect(mockReload).toHaveBeenCalled();
    });
  });
});

/**
 * Symply Health rows. The Health home screen pushes `widget_health_today` on
 * every water change, so both the logout wipe and the failure modes of that
 * write path need explicit cover.
 */
describe('WIDGET-026 — widget_health_today is covered by the logout wipe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeUnlinked = false;
  });

  it('WIDGET-026: widget_health_today is in the native clear() allowlist', () => {
    // The allowlist exists only in Swift, so it is asserted as source text. It
    // must stay a superset of every key `setSnapshot` is called with, or Health
    // data survives sign-out on the home screen / a paired watch.
    const swift = fs.readFileSync(
      path.resolve(__dirname, '../../..', 'modules/widget-sync/ios/WidgetSyncModule.swift'),
      'utf8'
    );

    const block = swift.match(/Function\("clear"\)\s*\{([\s\S]*?)removeObject/);
    expect(block).not.toBeNull();
    const allowlist = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    expect(allowlist).toContain('widget_health_today');
    // Health must be wiped alongside every sibling brand — never on its own.
    expect(allowlist).toEqual(
      expect.arrayContaining([
        'widget_budget_summary',
        'widget_kaizen_today',
        'widget_language_today',
        'widget_health_today',
      ])
    );
  });

  it('WIDGET-026: clear() calls through to the native module after a Health write', () => {
    widgetSync.setSnapshot('widget_health_today', { water_ml: 720, water_goal_ml: 1920 });
    expect(mockSetSnapshot).toHaveBeenCalledWith(
      'widget_health_today',
      JSON.stringify({ water_ml: 720, water_goal_ml: 1920 })
    );

    widgetSync.clear();
    expect(mockClear).toHaveBeenCalledTimes(1);
    // clear() takes no arguments — the allowlist is owned entirely by Swift.
    expect(mockClear.mock.calls[0]).toHaveLength(0);
  });
});

describe('WIDGET-027 — setSnapshot never throws into the caller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeUnlinked = false;
  });

  it('WIDGET-027: no-ops when the native module is null (unlinked build)', () => {
    // `requireOptionalNativeModule` resolves null on Android / Expo Go / any iOS
    // target built without the widget extension. HealthHomeScreen pushes the
    // snapshot from a plain useEffect, so a throw here would break the screen.
    const unlinked = loadWidgetSync(false);

    expect(unlinked.isAvailable()).toBe(false);
    expect(() =>
      unlinked.setSnapshot('widget_health_today', { water_ml: 240, water_goal_ml: 1920 })
    ).not.toThrow();
    expect(mockSetSnapshot).not.toHaveBeenCalled();
  });

  it('WIDGET-027: swallows a throwing native module (safe() catch path)', () => {
    const boom = new Error('App Group unavailable');
    mockSetSnapshot.mockImplementationOnce(() => {
      throw boom;
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => widgetSync.setSnapshot('widget_health_today', { water_ml: 240 })).not.toThrow();

    expect(mockSetSnapshot).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[WidgetSync] native call failed:', boom);
    errorSpy.mockRestore();
  });

  it('WIDGET-027: a throw on one write does not poison the next one', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSetSnapshot.mockImplementationOnce(() => {
      throw new Error('transient');
    });

    widgetSync.setSnapshot('widget_health_today', { water_ml: 240 });
    widgetSync.setSnapshot('widget_health_today', { water_ml: 480 });

    expect(mockSetSnapshot).toHaveBeenCalledTimes(2);
    expect(mockSetSnapshot).toHaveBeenLastCalledWith(
      'widget_health_today',
      JSON.stringify({ water_ml: 480 })
    );
    errorSpy.mockRestore();
  });
});
