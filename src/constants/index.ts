// Application constants

export const STORAGE_KEYS = {
  AUTH_TOKEN: '@auth_token',
  REFRESH_TOKEN: '@refresh_token',
  USER_DATA: '@user_data',
  THEME_PREFERENCE: '@theme_preference',
  ONBOARDING_COMPLETED: '@onboarding_completed',
  LANGUAGE: '@language',
  LAST_SYNC: '@last_sync',
} as const;

export const QUERY_KEYS = {
  USER: 'user',
  USER_PROFILE: 'userProfile',
  HOUSEHOLDS: 'households',
  HOUSEHOLD: 'household',
  REPORTS: 'reports',
  REPORT: 'report',
  FINDINGS: 'findings',
  MAINTENANCE_TASKS: 'maintenance_tasks',
} as const;

export const ANIMATION_DURATION = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
} as const;

export const HAPTIC_FEEDBACK = {
  LIGHT: 'impactLight',
  MEDIUM: 'impactMedium',
  HEAVY: 'impactHeavy',
  SUCCESS: 'notificationSuccess',
  WARNING: 'notificationWarning',
  ERROR: 'notificationError',
} as const;
