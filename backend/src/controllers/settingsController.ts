/**
 * Settings Controller
 * Business logic for settings operations
 */

import * as settingsService from '../services/settingsService';
import { nowIso } from '../utils/id';

export interface SettingInput {
  key: string;
  value?: any;
  updated_at: string;
}

export interface SyncResult {
  settings: Array<{
    key: string;
    value: any;
    updated_at: string;
  }>;
  conflicts?: Array<{
    key: string;
    client_value: any;
    server_value: any;
  }>;
  synced_at: string;
}

export async function fetchAllSettings(
  d1: D1Database,
  userId: string,
  householdId?: string
) {
  return await settingsService.fetchAllSettings(d1, userId, householdId);
}

export async function syncSettings(
  d1: D1Database,
  userId: string,
  householdId: string | undefined,
  clientSettings: SettingInput[],
  lastSyncedAt?: string | null
): Promise<SyncResult> {
  const serverSettings = await settingsService.fetchAllSettings(d1, userId, householdId);
  const conflicts: Array<{ key: string; client_value: any; server_value: any }> = [];
  
  // Upsert client settings
  for (const clientSetting of clientSettings) {
    const serverSetting = serverSettings.find((s) => s.key === clientSetting.key);
    
    // Simple conflict resolution: server wins if modified after client
    if (serverSetting && lastSyncedAt) {
      const serverModified = new Date(serverSetting.updated_at);
      const clientModified = new Date(clientSetting.updated_at);
      const lastSync = new Date(lastSyncedAt);
      
      if (serverModified > lastSync && clientModified > lastSync) {
        conflicts.push({
          key: clientSetting.key,
          client_value: clientSetting.value,
          server_value: serverSetting.value,
        });
        continue; // Skip - keep server version
      }
    }
    
    await settingsService.upsertSetting(
      d1,
      userId,
      householdId,
      clientSetting.key,
      clientSetting.value
    );
  }

  // Fetch all settings after upsert
  const finalSettings = await settingsService.fetchAllSettings(d1, userId, householdId);
  
  return {
    settings: finalSettings.map((s) => ({
      key: s.key,
      value: s.value,
      updated_at: s.updated_at,
    })),
    conflicts: conflicts.length > 0 ? conflicts : undefined,
    synced_at: nowIso(),
  };
}

export async function updateSetting(
  d1: D1Database,
  userId: string,
  householdId: string | undefined,
  key: string,
  value: any
) {
  return await settingsService.upsertSetting(d1, userId, householdId, key, value);
}

export async function deleteSetting(
  d1: D1Database,
  userId: string,
  householdId: string | undefined,
  key: string
) {
  return await settingsService.deleteSetting(d1, userId, householdId, key);
}
