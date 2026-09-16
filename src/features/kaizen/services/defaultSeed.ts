import { OPTIONAL_LIFE_SYSTEMS, PRIMARY_LIFE_SYSTEMS } from '../constants';
import type {
  KaizenActionEntry,
  KaizenInterviewQuestionEntry,
  KaizenProfileEntry,
  KaizenSkillNodeEntry,
  KaizenWeeklyRotationEntry,
} from '../types';

import { kaizenSeedId } from './seedId';

export interface KaizenDefaultSeed {
  profile: KaizenProfileEntry;
  actions: KaizenActionEntry[];
  rotations: KaizenWeeklyRotationEntry[];
  skills: KaizenSkillNodeEntry[];
  questions: KaizenInterviewQuestionEntry[];
}

/**
 * First-run seed. Creates ONLY the empty profile shell (timezone + system
 * activation defaults) — the app starts with no content. Daily-core actions,
 * career skills, weekly rotations, and interview questions are all built by the
 * user through onboarding (system config, career setup, resume import, rotation
 * editor), never pre-populated with demo data.
 *
 * Legacy installs that received the old demo seed (React / AWS rotations, career
 * skill list, starter interview questions) are cleaned up by
 * `purgeLegacyDemoSeed` on next sync.
 */
export function createKaizenDefaultSeed(
  userId: string,
  now: Date = new Date(),
): KaizenDefaultSeed {
  const timestamp = now.toISOString();
  const allSystems = [...PRIMARY_LIFE_SYSTEMS, ...OPTIONAL_LIFE_SYSTEMS];
  const activationStates = Object.fromEntries(allSystems.map(s => [s, 'available']));

  const profile: KaizenProfileEntry = {
    id: kaizenSeedId('profile'),
    user_id: userId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    onboarding_complete: 0,
    enabled_systems: JSON.stringify([]),
    system_activation_states: JSON.stringify(activationStates),
    primary_system: null,
    daily_core_ids: null,
    career_setup_step: null,
    target_roles: null,
    career_goal_types: null,
    selected_career_skill_ids: null,
    resume_source_name: null,
    resume_summary: null,
    career_plan_summary: null,
    interaction_style: null,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };

  return { profile, actions: [], rotations: [], skills: [], questions: [] };
}
