import NetInfo from '@react-native-community/netinfo';
import BackgroundFetch from 'react-native-background-fetch';

import { ENV } from '@config/env';
import { useAppStore } from '@stores/appStore';

// Background sync task identifier
const BACKGROUND_SYNC_TASK = 'com.simplehouse.backgroundsync';

interface SyncResult {
  success: boolean;
  timestamp: number;
  error?: string;
}

class BackgroundSyncService {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Configure background fetch
      const status = await BackgroundFetch.configure(
        {
          minimumFetchInterval: 15, // Minimum interval in minutes
          stopOnTerminate: false,
          startOnBoot: true,
          enableHeadless: true,
          requiredNetworkType: BackgroundFetch.NETWORK_TYPE_ANY,
        },
        async (taskId) => {
          console.log('[BackgroundSync] Task received:', taskId);
          await this.performSync();
          BackgroundFetch.finish(taskId);
        },
        (taskId) => {
          console.log('[BackgroundSync] Task timeout:', taskId);
          BackgroundFetch.finish(taskId);
        }
      );

      console.log('[BackgroundSync] Status:', status);
      this.isInitialized = true;
    } catch (error) {
      console.error('[BackgroundSync] Configuration failed:', error);
    }
  }

  async performSync(): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      timestamp: Date.now(),
    };

    try {
      // Check network connectivity
      const networkState = await NetInfo.fetch();
      if (!networkState.isConnected) {
        result.error = 'No network connection';
        return result;
      }

      // Perform sync operations
      await this.syncData();

      // Update last sync timestamp
      useAppStore.getState().setLastSyncTimestamp(Date.now());

      result.success = true;
      console.log('[BackgroundSync] Sync completed successfully');
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      console.error('[BackgroundSync] Sync failed:', error);
    }

    return result;
  }

  private async syncData(): Promise<void> {
    // Implement your sync logic here
    // This could include:
    // - Uploading pending changes to CloudFront/backend
    // - Downloading new data
    // - Syncing user preferences
    // - Refreshing auth tokens

    // Simulated sync delay
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }

  async scheduleTask(): Promise<void> {
    try {
      await BackgroundFetch.scheduleTask({
        taskId: BACKGROUND_SYNC_TASK,
        delay: ENV.TIMEOUTS.BACKGROUND_SYNC,
        periodic: true,
        requiresNetworkConnectivity: true,
        requiresCharging: false,
      });
      console.log('[BackgroundSync] Task scheduled');
    } catch (error) {
      console.error('[BackgroundSync] Failed to schedule task:', error);
    }
  }

  async start(): Promise<void> {
    try {
      await BackgroundFetch.start();
      console.log('[BackgroundSync] Started');
    } catch (error) {
      console.error('[BackgroundSync] Failed to start:', error);
    }
  }

  async stop(): Promise<void> {
    try {
      await BackgroundFetch.stop();
      console.log('[BackgroundSync] Stopped');
    } catch (error) {
      console.error('[BackgroundSync] Failed to stop:', error);
    }
  }
}

export const backgroundSync = new BackgroundSyncService();
