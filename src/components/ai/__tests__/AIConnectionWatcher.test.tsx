/**
 * Ambient AI-connection watcher.
 *
 * Asserts the invisible root watcher: it renders nothing, only runs once
 * authenticated, and on the active provider flipping to disconnected fires BOTH
 * an in-app toast AND a local system notification (tagged `ai_disconnected` for
 * tap-to-reconnect). The system notification is de-duplicated per provider per
 * episode, and recovery clears the dedupe + shows a "reconnected" toast.
 */

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  __esModule: true,
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

const mockScheduleLocal = jest.fn().mockResolvedValue('notif-id');
jest.mock('@services/notifications', () => ({
  __esModule: true,
  notificationService: {
    scheduleLocalNotification: (...args: unknown[]) => mockScheduleLocal(...args),
  },
}));

// Health hook — mutable so each render can flip the connection state.
const mockHealth = { isDisconnected: false, activeProvider: null as string | null };
jest.mock('@hooks/useAIConnectionHealth', () => ({
  __esModule: true,
  useAIConnectionHealth: () => mockHealth,
}));

// Auth gate — default signed in.
let mockAuthed = true;
jest.mock('@stores/authStore', () => ({
  __esModule: true,
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: mockAuthed }),
}));

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AIConnectionWatcher } from '../AIConnectionWatcher';

function render(): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<AIConnectionWatcher />);
  });
  return r;
}

function update(r: ReactTestRenderer): void {
  act(() => {
    r.update(<AIConnectionWatcher />);
  });
}

beforeEach(() => {
  mockShowToast.mockClear();
  mockScheduleLocal.mockClear();
  mockAuthed = true;
  Object.assign(mockHealth, { isDisconnected: false, activeProvider: null });
});

describe('AIConnectionWatcher', () => {
  it('renders nothing and fires nothing while healthy', () => {
    const r = render();
    expect(r.toJSON()).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockScheduleLocal).not.toHaveBeenCalled();
  });

  it('does not run (no toast/notification) when signed out', () => {
    mockAuthed = false;
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'anthropic' });
    const r = render();
    expect(r.toJSON()).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockScheduleLocal).not.toHaveBeenCalled();
  });

  it('fires a toast AND a tagged system notification on disconnect', () => {
    const r = render(); // healthy first render
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'anthropic' });
    update(r);

    expect(mockShowToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('disconnected'),
      5000
    );
    expect(mockScheduleLocal).toHaveBeenCalledWith(
      expect.stringContaining('disconnected'),
      expect.any(String),
      null,
      { type: 'ai_disconnected', provider: 'anthropic' }
    );
  });

  it('de-duplicates the system notification per provider per episode', () => {
    const r = render();
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'openai' });
    update(r);
    // A re-render still disconnected must not re-notify (state unchanged).
    update(r);
    expect(mockScheduleLocal).toHaveBeenCalledTimes(1);
  });

  it('shows a reconnected toast and clears dedupe on recovery', () => {
    const r = render();
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'gemini' });
    update(r);
    mockShowToast.mockClear();

    Object.assign(mockHealth, { isDisconnected: false, activeProvider: 'gemini' });
    update(r);
    expect(mockShowToast).toHaveBeenCalledWith(
      'success',
      expect.stringContaining('reconnected'),
      3000
    );

    // Dedupe cleared → a second disconnect episode notifies again.
    mockScheduleLocal.mockClear();
    Object.assign(mockHealth, { isDisconnected: true, activeProvider: 'gemini' });
    update(r);
    expect(mockScheduleLocal).toHaveBeenCalledTimes(1);
  });
});
