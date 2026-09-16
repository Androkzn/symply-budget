export {
  paginationQuerySchema,
  paginatedResponseSchema,
  type PaginationQuery,
  type PaginatedResponse,
} from './pagination';

export {
  householdPhotoUrlSchema,
  type HouseholdPhotoUrl,
} from './household-photo';

export {
  householdListItemSchema,
  householdsListResponseSchema,
  type HouseholdListItem,
  type HouseholdsListResponse,
} from './household';

export {
  householdMemberSchema,
  householdDetailResponseSchema,
  type HouseholdMemberContract,
  type HouseholdDetailResponse,
} from './household-member';

export {
  applianceListItemSchema,
  appliancesListResponseSchema,
  applianceResponseSchema,
  type ApplianceListItem,
  type AppliancesListResponse,
  type ApplianceResponse,
} from './appliance';

export {
  homeFeatureListItemSchema,
  homeFeaturesListResponseSchema,
  type HomeFeatureListItem,
  type HomeFeaturesListResponse,
} from './home-feature';

export {
  taskListItemSchema,
  tasksListResponseSchema,
  type TaskListItem,
  type TasksListResponse,
} from './task';

export {
  subscriptionSchema,
  subscriptionMeResponseSchema,
  type SubscriptionContract,
  type SubscriptionMeResponse,
} from './subscription';

export {
  notificationHistoryItemSchema,
  notificationsHistoryResponseSchema,
  notificationsUnreadCountResponseSchema,
  type NotificationHistoryItem,
  type NotificationsHistoryResponse,
  type NotificationsUnreadCountResponse,
} from './notification';

export {
  reportListItemSchema,
  reportsListResponseSchema,
  reportDetailResponseSchema,
  type ReportListItem,
  type ReportsListResponse,
  type ReportDetailResponse,
} from './report';

export {
  aiModelOptionSchema,
  aiCredentialSummarySchema,
  aiAccessResponseSchema,
  type AIModelOptionContract,
  type AICredentialSummaryContract,
  type AIAccessResponseContract,
} from './ai-access';

export {
  TRANSFER_PACKAGES,
  TRANSFER_PACKAGE_CATALOG,
  TRANSFER_PACKAGE_LABELS,
  getTransferPackage,
  type TransferPackageId,
  type TransferPackageDef,
  type TransferPackageCatalogEntry,
} from './transfer-package';

export {
  PROPERTY_JURISDICTIONS,
  propertyJurisdictionKey,
  resolvePropertyJurisdiction,
  propertyJurisdictionsForCountry,
  taxableValueCents,
  resolveAppealDeadline,
  type PropertyCountryCode,
  type PropertyJurisdiction,
  type PropertyReliefProgram,
  type AppealDeadlineRule,
} from './property-jurisdiction';

export {
  US_STATE_JURISDICTIONS,
  US_COUNTY_LOOKUPS,
  US_BILL_DELIVERY,
  usJurisdictionKey,
  resolveUsJurisdiction,
  allUsStateJurisdictions,
  usJurisdictionsForState,
  normalizeUsFips,
  resolveUsCountyLookup,
  usAssessmentRatioPercent,
  usTaxableValueCents,
  type RateBasis,
  type AssessingJurisdictionType,
  type UsDistrictClass,
  type UsDistrictClassRatio,
  type UsSubStateRatio,
  type UsAssessmentCap,
  type UsExemptionDelivery,
  type UsHomesteadExemption,
  type UsBillingTiming,
  type UsStateJurisdiction,
  type UsCountyLookup,
} from './property-jurisdiction-us';

export {
  HOME_PROJECT_VISIBILITIES,
  HOME_PROJECT_ROLES,
  homeProjectVisibilitySchema,
  homeProjectRoleSchema,
  homeProjectAccessGrantSchema,
  homeProjectAccessGrantsSchema,
  homeProjectAccessUpdateSchema,
  homeProjectAccessMemberSchema,
  homeProjectAccessViewSchema,
  normalizeHomeProjectVisibility,
  normalizeHomeProjectRole,
  parseHomeProjectAccessGrants,
  serializeHomeProjectAccessGrants,
  effectiveHomeProjectRole,
  canViewHomeProject,
  canEditHomeProject,
  type HomeProjectVisibility,
  type HomeProjectRole,
  type HomeProjectAccessGrant,
  type HomeProjectAccessUpdate,
  type HomeProjectAccessMember,
  type HomeProjectAccessView,
  type HomeProjectAccessFields,
} from './home-project-access';

export {
  HOME_PROJECT_MAX_LINKED_TASKS,
  parseHomeProjectLinkedTaskIds,
  serializeHomeProjectLinkedTaskIds,
  withHomeProjectLinkedTask,
  withoutHomeProjectLinkedTask,
} from './home-project-linked-tasks';

export {
  ROOM_SURFACE_SCHEMA_VERSION,
  OPENING_DEDUCTS_BY_DEFAULT,
  vec2Schema,
  outlineSchema,
  openingTypeSchema,
  openingSchema,
  materialKindSchema,
  tilePatternSchema,
  materialSchema,
  subAreaSchema,
  surfaceKindSchema,
  surfaceSchema,
  legacyGeometryPayloadSchema,
  legacyMirrorSchema,
  roomSurfaceModelSchema,
  parseRoomSurfaceModel,
  parseLegacyGeometryPayload,
  type Vec2,
  type OpeningType,
  type Opening,
  type MaterialKind,
  type TilePattern,
  type Material,
  type SubArea,
  type SurfaceKind,
  type Surface,
  type RoomSurfaceModel,
  type LegacyGeometryPayload,
} from './room-surface-model';

export * from './room-surface';

export * from './smart-project';

export {
  parseOpenGraph,
  parseJsonLd,
  extractReadableText,
  parsePriceToCents,
  absoluteImageUrl,
} from './link-extraction';

export {
  EXTRACT_MATERIAL_LISTING_SCHEMA,
  EXTRACT_MATERIAL_LISTING_SYSTEM_PROMPT,
  buildExtractMaterialListingUserPrompt,
  type RawMaterialListing,
} from './material-listing-prompt';

export {
  compactRecord,
  hostnameOf,
  mergeListingIntoDraft,
  type MaterialSpec as MaterialListingSpec,
  type SelectionDraft,
} from './material-listing-merge';

export {
  EMPTY_MATERIAL_APPEARANCE,
  EMPTY_MATERIAL_SALE_OFFER,
  colorSpecFor,
  hasSaleOffer,
  normalizeHexColor,
  normalizeMaterialAppearance,
  normalizeMaterialListingExtras,
  normalizeMaterialSaleOffer,
  toMillimetres,
  type MaterialAppearance,
  type MaterialSaleOffer,
} from './home-project-material';

export {
  finishIdForSelection,
  finishKindForCategory,
  materialFromSelection,
  type SelectionFinishInput,
  type MaterialFromSelectionOptions,
  type MaterialFromSelectionResult,
} from './material-to-finish';

export {
  BUDGET_CATEGORY_ICON_SLUGS,
  DEFAULT_BUDGET_CATEGORIES,
  LOCAL_SEED_CATEGORIES,
  SERVER_DEFAULT_CATEGORY_NAMES,
  SERVER_SEED_CATEGORIES,
  defaultCategoryId,
  type BudgetCategoryScope,
  type DefaultBudgetCategory,
} from './budget-categories';
