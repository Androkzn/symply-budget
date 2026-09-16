// Core stores
export { useAuthStore } from './authStore';
export { useAppStore } from './appStore';
export { useHouseholdStore } from './householdStore';
export { useMemberStore } from './memberStore';
export { useSpaceStore } from './spaceStore';

// Task & Report stores
export { useTaskStore } from './taskStore';
export { useTaskDraftStore } from './taskDraftStore';
export { useReportStore } from './reportStore';

// Labor Hub stores
export { useAppointmentStore } from './appointmentStore';
export { useProjectStore } from './projectStore';
export { useQuoteStore } from './quoteStore';
export { useMessageStore } from './messageStore';

// Household chat store moved to the shared module — import a config's `store`
// (and `selectTotalUnread`) from `@features/chat` instead.

// Home management stores
export { useHomeFeaturesStore } from './homeFeaturesStore';
export { useMaintenanceSuggestionsStore } from './maintenanceSuggestionsStore';
export { useImagesStore } from './imagesStore';

// Notification store
export { useNotificationStore } from './notificationStore';

// UI customization stores
export { useNavigationCustomizationStore } from './navigationCustomizationStore';
export { useWidgetLayoutStore } from './widgetLayoutStore';
export { useSettingsStore } from './settingsStore';

// Feature flag store (global remote kill-switch)
export { useFeatureFlagStore, isFeatureEnabled } from './featureFlagStore';
