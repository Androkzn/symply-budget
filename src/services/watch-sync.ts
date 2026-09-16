/**
 * Watch Sync Service
 *
 * Service for synchronizing data with Apple Watch
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { WatchBridge } = NativeModules;

/**
 * Watch reachability status
 */
export interface WatchStatus {
  supported: boolean;
  paired?: boolean;
  watchAppInstalled?: boolean;
  reachable?: boolean;
}

/**
 * Service for syncing data with Apple Watch
 */
class WatchSyncService {
  private eventEmitter: NativeEventEmitter | null = null;
  private isInitialized = false;

  /**
   * Initialize watch sync service
   */
  initialize() {
    if (!this.isAvailable()) {
      console.log('[WatchSync] Watch sync not available on this platform');
      return;
    }

    if (this.isInitialized) {
      console.log('[WatchSync] Already initialized');
      return;
    }

    this.eventEmitter = new NativeEventEmitter(WatchBridge);

    // Listen for watch events
    this.eventEmitter.addListener('onWatchTaskCompleted', (event) => {
      console.log('[WatchSync] Task completed on watch:', event.taskId);
      // You can emit this to your task store to refresh tasks
    });

    this.eventEmitter.addListener('onWatchSyncRequested', () => {
      console.log('[WatchSync] Watch requested sync');
      // You can trigger a task sync here
    });

    this.isInitialized = true;
    console.log('[WatchSync] Initialized');
  }

  /**
   * Check if watch sync is available (iOS only)
   */
  isAvailable(): boolean {
    return Platform.OS === 'ios' && WatchBridge != null;
  }

  /**
   * Sync authentication tokens to watch
   */
  async syncAuthTokens(token: string, householdId: string, userId: string): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      WatchBridge.syncAuthTokens(token, householdId, userId);
      console.log('[WatchSync] Auth tokens synced to watch');
    } catch (error) {
      console.error('[WatchSync] Error syncing auth tokens:', error);
    }
  }

  /**
   * Sync tasks to watch
   */
  async syncTasks(tasks: any[]): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      const tasksJson = JSON.stringify(tasks);
      WatchBridge.syncTasksToWatch(tasksJson);
      console.log(`[WatchSync] Synced ${tasks.length} tasks to watch`);
    } catch (error) {
      console.error('[WatchSync] Error syncing tasks:', error);
    }
  }

  /**
   * Sync today's Aihousekeeper briefing to the Apple Watch (plan §H7).
   *
   * No-op on non-iOS or when the native WatchBridge is unavailable. Safe to
   * call repeatedly; the native side dedupes by `(paragraph, date)` via the
   * App Group cache.
   */
  async syncBriefing(paragraph: string, date: string): Promise<void> {
    if (!this.isAvailable()) return;
    if (!paragraph || !date) return;

    try {
      WatchBridge.syncBriefing(paragraph, date);
    } catch (error) {
      console.error('[WatchSync] Error syncing briefing:', error);
    }
  }

  /**
   * Persist the API base URL to the shared App Group so the Watch and the Home
   * Screen widget call the same environment the app is signed in to (staging on
   * dev builds, production on release). Call alongside {@link syncAuthTokens}.
   */
  async setApiBaseUrl(url: string): Promise<void> {
    if (!this.isAvailable() || !url) return;

    try {
      WatchBridge.setApiBaseUrl(url);
    } catch (error) {
      console.error('[WatchSync] Error setting API base URL:', error);
    }
  }

  /**
   * Push the freshest Home insight (the raw Mira insight object) to the Home
   * Screen widget via the App Group, and refresh the widget so it renders live
   * content immediately. No-op on non-iOS.
   */
  async syncHomeInsight(insight: unknown): Promise<void> {
    if (!this.isAvailable() || !insight) return;

    try {
      WatchBridge.syncHomeInsight(JSON.stringify(insight));
    } catch (error) {
      console.error('[WatchSync] Error syncing home insight:', error);
    }
  }

  /**
   * Push the latest task feed to the Home Screen widget via the App Group so
   * its urgent-task list updates from the app, independent of the widget's own
   * (short-lived) access token. Pass tasks with snake_case fields
   * (`next_due_date`, `priority_severity`, `is_active`, …). No-op on non-iOS.
   */
  async syncWidgetTasks(tasks: unknown): Promise<void> {
    if (!this.isAvailable() || !tasks) return;

    try {
      WatchBridge.syncWidgetTasks(JSON.stringify(tasks));
    } catch (error) {
      console.error('[WatchSync] Error syncing widget tasks:', error);
    }
  }

  /**
   * Force a Home Screen widget timeline refresh.
   */
  async reloadWidgets(): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      WatchBridge.reloadWidgets();
    } catch (error) {
      console.error('[WatchSync] Error reloading widgets:', error);
    }
  }

  /**
   * Clear watch data (call on logout)
   */
  async clearWatchData(): Promise<void> {
    if (!this.isAvailable()) return;

    try {
      WatchBridge.clearWatchData();
      console.log('[WatchSync] Watch data cleared');
    } catch (error) {
      console.error('[WatchSync] Error clearing watch data:', error);
    }
  }

  /**
   * Check if Apple Watch is connected and reachable
   */
  async getWatchStatus(): Promise<WatchStatus> {
    if (!this.isAvailable()) {
      return { supported: false };
    }

    try {
      const status = await WatchBridge.isWatchReachable();
      return status;
    } catch (error) {
      console.error('[WatchSync] Error checking watch status:', error);
      return { supported: false };
    }
  }

  /**
   * Cleanup event listeners
   */
  cleanup() {
    if (this.eventEmitter) {
      this.eventEmitter.removeAllListeners('onWatchTaskCompleted');
      this.eventEmitter.removeAllListeners('onWatchSyncRequested');
      this.eventEmitter = null;
    }
    this.isInitialized = false;
  }
}

export const watchSyncService = new WatchSyncService();
export default watchSyncService;
