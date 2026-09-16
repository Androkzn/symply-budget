/**
 * Symply Life (brand `symply-kaizen`) — domain constants.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/constants/kaizen.ts`).
 * `LifeSystem` values are persisted (profile `enabled_systems` / action `system`) and
 * are part of the sync contract — keep the string values identical.
 */

export enum LifeSystem {
  Health = 'health',
  Career = 'career',
  Mental = 'mental',
  PersonalLife = 'personalLife',
  Administration = 'administration',
  Learning = 'learning',
  Finance = 'finance',
}

export const PRIMARY_LIFE_SYSTEMS = [
  LifeSystem.Health,
  LifeSystem.Career,
  LifeSystem.Mental,
  LifeSystem.PersonalLife,
  LifeSystem.Administration,
] as const;

export const OPTIONAL_LIFE_SYSTEMS = [
  LifeSystem.Learning,
  LifeSystem.Finance,
] as const;

export type KaizenTabId =
  | 'today'
  | 'career'
  | 'assess'
  | 'questionBanks'
  | 'learn'
  | 'reviews'
  | 'insights'
  | 'settings';

export type KaizenTabTint =
  | 'teal'
  | 'indigo'
  | 'green'
  | 'orange'
  | 'purple'
  | 'mint'
  | 'blue'
  | 'gray';

export interface KaizenTabConfig {
  id: KaizenTabId;
  title: string;
  icon: string;
  tint: KaizenTabTint;
  phonePlacement: 'primary' | 'overflow';
}

/** Eight Life sections, ordered to match the iOS shell. */
export const KAIZEN_TABS: readonly KaizenTabConfig[] = [
  { id: 'today', title: 'Today', icon: 'sun.max.fill', tint: 'teal', phonePlacement: 'primary' },
  { id: 'career', title: 'Career', icon: 'briefcase.fill', tint: 'indigo', phonePlacement: 'primary' },
  { id: 'assess', title: 'Assess', icon: 'checkmark.seal.fill', tint: 'green', phonePlacement: 'primary' },
  { id: 'questionBanks', title: 'Banks', icon: 'tray.full.fill', tint: 'orange', phonePlacement: 'overflow' },
  { id: 'learn', title: 'Learn', icon: 'books.vertical.fill', tint: 'purple', phonePlacement: 'primary' },
  { id: 'reviews', title: 'Reviews', icon: 'calendar.badge.clock', tint: 'mint', phonePlacement: 'overflow' },
  { id: 'insights', title: 'Insights', icon: 'chart.line.uptrend.xyaxis', tint: 'blue', phonePlacement: 'overflow' },
  { id: 'settings', title: 'Settings', icon: 'gearshape.fill', tint: 'gray', phonePlacement: 'overflow' },
] as const;

/** Defaults: the Life shell and its AI scoring are enabled offline. */
export const DEFAULT_KAIZEN_FEATURE_FLAGS = {
  kaizen: true,
  kaizenAIScoring: true,
} as const;
