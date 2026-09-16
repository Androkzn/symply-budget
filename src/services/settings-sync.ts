import { captureException } from './monitoring';
import { storageHelpers } from './storage';

const DEBOUNCE_DELAY_MS = 500;
const RETRY_QUEUE_KEY = 'settings-sync-retry-queue';

interface PendingSync {
  key: string;
  value: any;
  timestamp: number;
}

/**
 * Settings Sync Service
 * Handles debounced synchronization of settings to database
 */
export class SettingsSyncService {
  private syncQueue: Map<string, any> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isOnline: boolean = true;
  private isSyncing: boolean = false;
  private isHydrating: boolean = false;

  /**
   * Initialize the sync service
   */
  init() {
    // Load any pending syncs from previous session
    this.loadRetryQueue();
  }

  /**
   * Set hydration mode (prevents sync during initial load)
   */
  setHydrating(isHydrating: boolean) {
    this.isHydrating = isHydrating;
    if (!isHydrating) {
      console.log('[SettingsSync] Hydration complete, sync enabled');
    }
  }

  /**
   * Set online status
   */
  setOnlineStatus(isOnline: boolean) {
    const wasOffline = !this.isOnline;
    this.isOnline = isOnline;

    // If we just came online, flush any pending syncs
    if (wasOffline && isOnline) {
      console.log('[SettingsSync] Back online, flushing pending syncs');
      this.flushNow();
    }
  }

  /**
   * Queue a setting change for sync
   */
  queueSync(key: string, value: any): void {
    // Skip sync during hydration
    if (this.isHydrating) {
      console.log(`[SettingsSync] Skipping sync during hydration: ${key}`);
      return;
    }

    console.log(`[SettingsSync] Queued: ${key}`);

    // Add to sync queue
    this.syncQueue.set(key, value);

    // Update MMKV cache immediately
    this.updateCacheImmediate(key, value);

    // Debounce the actual sync
    this.debouncedSync();
  }

  /**
   * Update cache immediately (for offline support)
   */
  private async updateCacheImmediate(key: string, value: any): Promise<void> {
    try {
      const cache = await storageHelpers.getObject<Record<string, any>>('settings-cache') || {};
      cache[key] = value;
      await storageHelpers.setObject('settings-cache', cache);
    } catch (error) {
      console.error('[SettingsSync] Error updating cache:', error);
      captureException(error, { source: 'SettingsSync', phase: 'update_cache' });
    }
  }

  /**
   * Debounced sync (waits 500ms after last change)
   */
  private debouncedSync = (): void => {
    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new timer
    this.debounceTimer = setTimeout(() => {
      this.flushNow();
    }, DEBOUNCE_DELAY_MS);
  };

  /**
   * Flush the sync queue immediately
   */
  async flushNow(): Promise<boolean> {
    // Don't sync if already syncing or offline
    if (this.isSyncing) {
      console.log('[SettingsSync] Already syncing, skipping');
      return false;
    }

    if (!this.isOnline) {
      console.log('[SettingsSync] Offline, saving to retry queue');
      this.saveToRetryQueue();
      return false;
    }

    // Check if there's anything to sync
    if (this.syncQueue.size === 0) {
      console.log('[SettingsSync] Nothing to sync');
      return true;
    }

    // Don't attempt a network sync while signed out (e.g. a theme/scheme change
    // on the Auth/Onboarding screens). It would 401, fail the token refresh with
    // no valid session, noisily red-box, and trip the client's refresh→logout
    // path. Keep the changes queued; they flush on login or the next change.
    // Loaded lazily: authStore imports this service, so a static import here
    // would create a module-initialization cycle.
    const { useAuthStore } = await import('@stores/authStore');
    if (!useAuthStore.getState().isAuthenticated) {
      console.log('[SettingsSync] Not signed in — deferring sync');
      this.saveToRetryQueue();
      return false;
    }

    this.isSyncing = true;

    try {
      // Convert queue to object
      const updates: Record<string, any> = {};
      this.syncQueue.forEach((value, key) => {
        updates[key] = value;
      });

      console.log('[SettingsSync] Syncing changes:', Object.keys(updates));

      // Load lazily so the auth store can import this service without creating
      // a module initialization cycle through the shared API client.
      const { settingsApi } = await import('@api/settings');
      await settingsApi.bulkUpdate(updates);

      // Clear the queue on success
      this.syncQueue.clear();

      console.log('[SettingsSync] Sync successful');
      return true;
    } catch (error) {
      // A 401 here is expected when the session became invalid mid-flush — the
      // API client already handles refresh/logout and the changes stay queued,
      // so it's not worth a red-box. Only surface genuinely unexpected failures.
      //
      // `HouseLocalEnrolmentPendingError` is the second such case, and it is
      // MORE expected than the 401, not less: a device that has claimed an
      // invite sits in this state for the whole approval window — however long
      // the owner takes to tap approve — and the error's own member-facing copy
      // says so ("Changes are paused until then"). Reporting it as a failure
      // was wrong twice over. It red-boxed a normal state, and it sent a
      // Sentry event per flush for a device that is working exactly as
      // designed. Both matter most during a two-device enrolment, which is
      // precisely when the log needs to be readable.
      //
      // Matched by `name` rather than `instanceof`: importing the error class
      // would pull `@features/house/local` — the sync orchestrator, the status
      // store, the control-plane client — into a service that runs on every
      // settings write, which is the narrow-require rule `localApiProxy.ts`
      // states for the same reason.
      const status = (error as { response?: { status?: number } })?.response?.status;
      const name = (error as { name?: string })?.name;
      if (status === 401) {
        console.log('[SettingsSync] Sync deferred — session not valid (401)');
      } else if (name === 'HouseLocalEnrolmentPendingError') {
        console.log('[SettingsSync] Sync paused — device awaiting owner approval');
      } else {
        console.error('[SettingsSync] Sync failed:', error);
        captureException(error, { source: 'SettingsSync', phase: 'flush' });
      }

      // Save to retry queue
      this.saveToRetryQueue();

      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Save current queue to retry queue (for offline support)
   */
  private async saveToRetryQueue(): Promise<void> {
    try {
      const pending: PendingSync[] = [];

      this.syncQueue.forEach((value, key) => {
        pending.push({
          key,
          value,
          timestamp: Date.now(),
        });
      });

      await storageHelpers.setObject(RETRY_QUEUE_KEY, pending);
      console.log(`[SettingsSync] Saved ${pending.length} changes to retry queue`);
    } catch (error) {
      console.error('[SettingsSync] Error saving retry queue:', error);
      captureException(error, { source: 'SettingsSync', phase: 'save_retry_queue' });
    }
  }

  /**
   * Load and retry pending syncs from previous session
   */
  private async loadRetryQueue(): Promise<void> {
    try {
      const pending = await storageHelpers.getObject<PendingSync[]>(RETRY_QUEUE_KEY);

      if (!pending || pending.length === 0) {
        return;
      }

      console.log(`[SettingsSync] Found ${pending.length} pending syncs from previous session`);

      // Add to current queue
      pending.forEach((item) => {
        this.syncQueue.set(item.key, item.value);
      });

      // Clear the retry queue
      await storageHelpers.delete(RETRY_QUEUE_KEY);

      // Try to sync if online
      if (this.isOnline) {
        this.flushNow();
      }
    } catch (error) {
      console.error('[SettingsSync] Error loading retry queue:', error);
      captureException(error, { source: 'SettingsSync', phase: 'load_retry_queue' });
    }
  }

  /**
   * Get the number of pending syncs
   */
  getPendingCount(): number {
    return this.syncQueue.size;
  }

  /**
   * Clear all pending syncs (for testing)
   */
  async clearQueue(): Promise<void> {
    this.syncQueue.clear();
    await storageHelpers.delete(RETRY_QUEUE_KEY);
    console.log('[SettingsSync] Cleared sync queue');
  }
}

// Export singleton instance
export const settingsSync = new SettingsSyncService();
