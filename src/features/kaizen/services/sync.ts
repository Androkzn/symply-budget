import { recordE2EPersistEntry } from '@api/e2eTestObservability';

import { syncKaizen } from '../api/kaizen';

import { createKaizenDefaultSeed } from './defaultSeed';
import { purgeLegacyDemoSeed } from './purgeDemoSeed';
import {
  applyServerChanges,
  clearDirtyFlags,
  getDirtyChanges,
  getLastSyncAt,
  getProfile,
  setLastSyncAt,
  upsertLocal,
} from './repository';

let syncInFlight: Promise<void> | null = null;

export async function runKaizenSync(userId: string): Promise<void> {
  if (syncInFlight) return syncInFlight;

  syncInFlight = (async () => {
    const profile = await getProfile(userId);
    if (!profile) {
      const seed = createKaizenDefaultSeed(userId);
      await upsertLocal('kaizen_profiles', seed.profile as never, { dirty: true });
      for (const action of seed.actions) {
        await upsertLocal('kaizen_actions', action as never, { dirty: true });
      }
      for (const rotation of seed.rotations) {
        await upsertLocal('kaizen_weekly_rotations', rotation as never, { dirty: true });
      }
      for (const skill of seed.skills) {
        await upsertLocal('kaizen_skill_nodes', skill as never, { dirty: true });
      }
      for (const question of seed.questions) {
        await upsertLocal('kaizen_interview_questions', question as never, { dirty: true });
      }
    }

    // Retire the old hardcoded demo seed (rotations/skills/questions/actions)
    // from accounts that received it before the seed was emptied. Runs before we
    // collect dirty changes so the tombstones push in this same sync round.
    await purgeLegacyDemoSeed(userId);

    const lastSyncAt = await getLastSyncAt();
    const changes = await getDirtyChanges(userId);
    recordE2EPersistEntry({
      store: 'kaizen_sqlite',
      operation: 'sync',
      detail: `dirty_tables=${Object.keys(changes).length}`,
    });
    const response = await syncKaizen({
      last_sync_at: lastSyncAt,
      changes,
    });
    await applyServerChanges(response.changes);
    await clearDirtyFlags(userId);
    await setLastSyncAt(response.server_time);
  })().finally(() => {
    syncInFlight = null;
  });

  return syncInFlight;
}
