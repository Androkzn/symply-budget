export { api, apiClient } from './client';
export { authApi } from './auth';
export { userApi } from './user';
export { householdsApi } from './households';
export { subscriptionApi } from './subscription';
export { aiAccessApi } from './aiAccess';
export type {
  AIAccessResponse,
  AIModelOption,
  AIProviderId,
  AIDenialReason,
} from './aiAccess';
export { featuresApi } from './features';
export type { FeatureFlagsResponse } from './features';
export { smartEngineApi, createIdempotencyKey } from './smart-engine';
export type {
  ExportPackageResult,
  ImportPackageResult,
  PrepareTransferResult,
  SmartEnginePackage,
  TransferConsentRecord,
  TransferPackageId,
} from './smart-engine';
export { templatesApi } from './templates';
export { garbageCollectionApi } from './garbage-collection';
export { appliancesApi, APPLIANCE_CATEGORIES, APPLIANCE_TYPES } from './appliances';
export { seasonalChecklistsApi, SEASONS, getCurrentSeason } from './seasonal-checklists';
export type { Household, HouseholdMember, HouseholdInvitation } from './households';
export type {
  Subscription,
  SubscriptionPlan,
  SubscriptionTier,
  SubscriptionStatus,
} from './subscription';
export type { MaintenanceTemplate, TemplateCategory } from './templates';
export type { GarbageSchedule, Municipality, CollectionDate } from './garbage-collection';
export type { Appliance, ApplianceDocument, ServiceHistoryEntry } from './appliances';
export type { SeasonalChecklist, SeasonalChecklistItem, Season } from './seasonal-checklists';
export { contractorSearchApi } from './contractor-search';
export type {
  FoundContractor,
  ContractorSearchResult,
  GeneratedEmail,
  EmailType,
  SearchLocation,
  SearchContractorsRequest,
  GenerateEmailRequest,
  SendEmailRequest,
  SendEmailResult,
} from './contractor-search';

// Labor Hub APIs
export { appointmentsApi, APPOINTMENT_TYPES, APPOINTMENT_STATUSES, APPOINTMENT_TYPE_INFO, APPOINTMENT_STATUS_INFO } from './appointments';
export type { Appointment, AppointmentWithDetails, CalendarAppointment, AppointmentType, AppointmentStatus } from './appointments';

export { quotesApi, QUOTE_STATUSES, QUOTE_STATUS_INFO } from './quotes';
export type { Quote, QuoteWithDetails, QuoteComparison, QuoteStatus } from './quotes';

export { projectsApi, PROJECT_STATUSES, PROJECT_STATUS_INFO, MILESTONE_STATUSES, PAYMENT_TYPES, PAYMENT_STATUSES } from './projects';
export type { Project, ProjectWithDetails, ProjectMilestone, ProjectPayment, ProjectProgressPhoto, ProjectStatus, MilestoneStatus, PaymentType, PaymentStatus } from './projects';

export { visitChecklistsApi, CHECKLIST_PRIORITIES, PRIORITY_INFO } from './visit-checklists';
export type { VisitChecklist, ChecklistWithItems, ChecklistItem, ChecklistTemplate, TemplateItem, TechnicalTerm, AIInfoConversation, ChecklistPriority } from './visit-checklists';

export { messagesApi, MESSAGE_DIRECTIONS, MESSAGE_CHANNELS, MESSAGE_STATUSES, MESSAGE_TEMPLATE_TYPES } from './messages';
export type { ContractorMessage, MessageWithContractor, ConversationSummary, MessageTemplate, MessageDirection, MessageChannel, MessageStatus, MessageTemplateType } from './messages';

// Household chat (multi-room messaging + AI assistant) moved to the shared
// module — import from `@features/chat` instead.

export { representativesApi } from './representatives';
export type { ContractorRepresentative } from './representatives';

export { ratingsApi, RATING_DIMENSIONS, RATING_DIMENSION_INFO } from './ratings';
export type { ContractorJobRating, RatingWithDetails, RatingSummary, RatingDimension } from './ratings';

// Task Drafts and Maintenance
export { taskDraftsApi } from './task-drafts';
export type {
  TaskDraft,
  TaskDraftWithRelations,
  TaskDraftsSummary,
  TaskDraftsFilters,
  ConvertDraftRequest,
  BulkConvertRequest,
  DismissDraftRequest,
} from './task-drafts';

// Home Features
export { homeFeaturesApi, FEATURE_TYPES, FEATURE_SUBTYPES, CONDITION_OPTIONS } from './home-features';
export type {
  HomeFeature,
  CreateHomeFeatureRequest,
  UpdateHomeFeatureRequest,
} from './home-features';

// Neighbours — the homes around this property and the people in them.
export {
  neighboursApi,
  NEIGHBOUR_RELATIONS,
  NEIGHBOUR_PERSON_ROLES,
  NEIGHBOUR_PLACE_SOURCES,
  RELATION_INFO,
  PERSON_ROLE_INFO,
  PLACE_SOURCE_LABELS,
} from './neighbours';
export type {
  Neighbour,
  NeighbourWithPeople,
  NeighbourPerson,
  Neighbourhood,
  NeighbourhoodWithCount,
  NeighbourRelation,
  NeighbourPersonRole,
  NeighbourPlaceSource,
  NeighbourFilters,
  CreateNeighbourRequest,
  UpdateNeighbourRequest,
  CreateNeighbourPersonRequest,
  UpdateNeighbourPersonRequest,
  CreateNeighbourhoodRequest,
  UpdateNeighbourhoodRequest,
} from './neighbours';

// Maintenance Suggestions
export {
  maintenanceSuggestionsApi,
  SUGGESTION_STATUS_INFO,
  FREQUENCY_LABELS,
  SEASON_LABELS,
} from './maintenance-suggestions';
export type {
  MaintenanceSuggestion,
  MaintenanceTemplate as MaintenanceSuggestionTemplate,
  SuggestionWithTemplate,
  ApplySuggestionsRequest,
  DismissSuggestionRequest,
  SnoozeSuggestionRequest,
} from './maintenance-suggestions';

// Images
export { imagesApi, IMAGE_TYPES } from './images';
export type {
  ReportImage,
  ImageType,
  GetImagesFilters,
  UploadImageOptions,
  UpdateImageRequest,
} from './images';

// Aihousekeeper (AI Housekeeper)
export { aihousekeeperApi } from './aihousekeeper';
export { oauthGoogleApi } from './oauthGoogle';
export type {
  OAuthGoogleStartResponse,
  OAuthGoogleStatusResponse,
} from './oauthGoogle';
export type {
  AssistantIdentity,
  AssistantIdentityPatch,
  AssistantBriefing,
  AssistantMemory,
  AssistantTrustLedgerEntry,
  AssistantFollowup,
  BriefingEmptyReason,
  MemoryType,
  AssistantLedgerCategory,
  FollowupStatus,
  UndoLedgerResult,
  UndoLedgerStatus,
  CachedBriefingPayload,
} from '@/types/aihousekeeper';

// Smart Budget
export { budgetApi } from './budget';
export { homeBudgetApi } from './home-budget';
export type { HomeBudgetGlance } from './home-budget';
export type {
  BudgetCategory,
  BudgetItem,
  BudgetGoal,
  Expense,
  TimelineItem,
  TimelineSummary,
  CategoryStats,
  BudgetOverview,
  ScoredBudgetItem,
  AffordabilityPlan,
  MonthlyOverview,
  BudgetInsightAlert,
  BudgetInsights,
  SubBudget,
  SubBudgetProgress,
  SubBudgetSummary,
  SubBudgetTotals,
  SubBudgetLimitType,
  SubBudgetScope,
  SubBudgetsResponse,
  UpsertSubBudgetRequest,
  DeleteSubBudgetRequest,
} from './budget';

// Wishes — long-term dreams / household wishlist (feed of notes, photos, links)
export { wishesApi } from './wishes';
export type {
  Wish,
  WishWithMeta,
  WishEntry,
  WishWithEntries,
  WishStatus,
  WishEntryKind,
  CreateWishInput,
  UpdateWishInput,
  AddWishEntryInput,
  UpdateWishEntryInput,
} from './wishes';

// Home Projects — renovation / improvement planning (House)
export {
  homeProjectsApi,
  homeProjectKeys,
  useHomeProjects,
  useHomeProjectHub,
  useCreateHomeProject,
} from './home-projects';
export type {
  HomeProject,
  HomeProjectHub,
  HomeProjectSelection,
  HomeProjectBudgetLine,
  HomeProjectPhase,
  HomeProjectBlocker,
  BudgetRollups,
  CreateHomeProjectInput,
  HomeProjectTemplate,
} from './home-projects';

// Mortgage tracking (Budget-only)
export { mortgageApi } from './mortgage';
export type {
  Mortgage,
  MortgageTerm,
  MortgageListItem,
  MortgageSummary,
  MortgageScheduleView,
  MortgageScheduleRow,
  MortgageRateType,
  MortgageCompounding,
  MortgageProductType,
  MortgagePaymentFrequency,
  CreateMortgageRequest,
  UpdateMortgageRequest,
  MortgageStatement,
  CreateStatementRequest,
  RenewMortgageRequest,
} from './mortgage';

// Recurring reminders — "keep nagging until it's actually done" action items
export { recurringRemindersApi } from './recurringReminders';
export type {
  RecurringReminder,
  RecurringReminderFrequency,
  RecurringReminderFrequencyOption,
} from './recurringReminders';

// Renewal reminders for Monthly Payments (Budget-only)
export { budgetRenewalsApi, budgetRenewalDocumentContentSource } from './budgetRenewals';
export type {
  BudgetRenewal,
  BudgetRenewalDocument,
  RenewalCategory,
  RenewalCycle,
  RenewalStatus,
  RenewalDocumentSource,
  UpsertRenewalRequest,
} from './budgetRenewals';

// Savings & Registered accounts
export { savingsApi } from './savings';
export type {
  SavingsCategory,
  SavingsIncomeEntry,
  SavingsSpendingEntry,
  SavingsIncomeTemplate,
  SavingsGoal,
  SavingsRecurringPayment,
  RegisteredAccount,
  RegisteredTransaction,
  SavingsOverview,
  SavingsTrend,
  SavingsTrendPoint,
  EmergencyFundSuggestion,
  RegisteredRoom,
  RecurringPaymentsView,
  RecurringPaymentGroup,
  SavingsImportDraft,
  SavingsImportJob,
  SavingsImportCommitResult,
  SavingsIncomeSourceType,
  SavingsGoalType,
  SavingsGoalStatus,
  RegisteredAccountType,
  RegisteredTransactionType,
  RegisteredTransactionKind,
} from './savings';