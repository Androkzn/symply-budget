/**
 * One-time cleanup of the legacy demo seed.
 *
 * Older builds pre-populated every new account with hardcoded demo content:
 * weekly rotations (React / System Design / AWS ...), a career skill list,
 * starter interview questions, and eight daily-core habit actions. That data was
 * never entered by the user, so we retire it — both from the local SQLite store
 * and (via the dirty tombstone → sync) from the synced account.
 *
 * Only rows with the deterministic seed ids are soft-deleted; anything the user
 * created (random uuid) is untouched. The profile seed row is intentionally kept.
 * Idempotent and guarded by a meta flag so it runs at most once per install.
 */
import type { KaizenTableName } from '../types';

import { getKaizenDatabase, getMeta, setMeta } from './database';
import { kaizenSeedId } from './seedId';

const PURGE_FLAG = 'demo_seed_purged_v1';

/** Skill names from the legacy `CAREER_SKILLS` demo list. */
const LEGACY_SKILL_NAMES = [
  'English', 'Coding', 'System Design', 'React', 'TypeScript', 'Swift',
  'AWS', 'Databases', 'AI Engineering', 'Algorithms', 'Architecture', 'Communication',
];

/** Question keys from the legacy `STARTER_QUESTIONS` demo bank. */
const LEGACY_QUESTION_KEYS = [
  'q.react.1', 'q.react.2', 'q.react.3', 'q.ts.1', 'q.ts.2', 'q.swift.1', 'q.swift.2',
  'q.aws.1', 'q.aws.2', 'q.sd.1', 'q.sd.2', 'q.sd.3', 'q.ai.1', 'q.ai.2', 'q.algo.1',
  'q.beh.1', 'q.beh.2', 'q.beh.3', 'q.beh.4', 'q.beh.5',
];

/** Action keys from the legacy `DAILY_CORE_SPECS` demo list. */
const LEGACY_ACTION_KEYS = [
  'action.weight', 'action.journal', 'action.mobility', 'action.reading',
  'action.english', 'action.planning', 'action.food', 'action.water',
];

/** Legacy demo seed ids grouped by table. Excludes the profile (kept). */
function legacyDemoSeedIds(): Array<{ table: KaizenTableName; ids: string[] }> {
  return [
    {
      table: 'kaizen_weekly_rotations',
      ids: [1, 2, 3, 4, 5, 6, 7].map(weekday => kaizenSeedId(`rotation.${weekday}`)),
    },
    {
      table: 'kaizen_skill_nodes',
      ids: LEGACY_SKILL_NAMES.map(name => kaizenSeedId(`skill.${name}`)),
    },
    {
      table: 'kaizen_interview_questions',
      ids: LEGACY_QUESTION_KEYS.map(key => kaizenSeedId(key)),
    },
    {
      table: 'kaizen_actions',
      ids: LEGACY_ACTION_KEYS.map(key => kaizenSeedId(key)),
    },
  ];
}

/**
 * Soft-delete any surviving legacy demo seed rows so they tombstone-sync to the
 * server. No-op after the first successful run. Returns the number of rows
 * marked deleted (for logging/tests).
 */
export async function purgeLegacyDemoSeed(userId: string): Promise<number> {
  if (await getMeta(PURGE_FLAG)) return 0;

  const db = await getKaizenDatabase();
  const now = new Date().toISOString();
  let purged = 0;

  for (const { table, ids } of legacyDemoSeedIds()) {
    const placeholders = ids.map(() => '?').join(', ');
    const result = await db.runAsync(
      `UPDATE ${table}
         SET deleted_at = ?, updated_at = ?, dirty = 1
       WHERE user_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
      [now, now, userId, ...ids],
    );
    purged += result.changes ?? 0;
  }

  await setMeta(PURGE_FLAG, now);
  return purged;
}
