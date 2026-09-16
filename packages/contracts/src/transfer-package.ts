/**
 * Soft Transfer package registry — canonical contract (ECO-2).
 * Backend adds direction resolution via brand-capabilities; mobile adds API types.
 */

export type TransferPackageId =
  | 'profile.core.v1'
  | 'house.property.v1'
  | 'budget.summary.v1'
  | 'home_project_cost_summary.v1'
  | 'profile.core.health.v1'
  | 'health.summary.v1'
  | 'profile.core.language.v1'
  | 'language.summary.v1';

export type TransferBrandId =
  | 'symply-house'
  | 'symply-budget'
  | 'symply-health'
  | 'symply-language';

export type TransferPackageDef = {
  packageId: TransferPackageId;
  version: number;
  sourceBrandId: TransferBrandId;
  destinationBrandId: TransferBrandId;
  requiresSourceHousehold: boolean;
  requiresDestinationHousehold: boolean;
  maxEnvelopeTtlMs: number;
  fieldManifest: readonly string[];
};

export type TransferPackageCatalogEntry = {
  label: string;
  description: string;
  requiresAi: boolean;
};

export const TRANSFER_PACKAGES: Readonly<Record<TransferPackageId, TransferPackageDef>> = {
  'profile.core.v1': {
    packageId: 'profile.core.v1',
    version: 1,
    sourceBrandId: 'symply-house',
    destinationBrandId: 'symply-budget',
    requiresSourceHousehold: false,
    requiresDestinationHousehold: false,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: ['displayName', 'locale', 'timezone'] as const,
  },
  'house.property.v1': {
    packageId: 'house.property.v1',
    version: 1,
    sourceBrandId: 'symply-house',
    destinationBrandId: 'symply-budget',
    requiresSourceHousehold: true,
    requiresDestinationHousehold: false,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: [
      'cityRegion',
      'propertyType',
      'householdSizeBand',
      'ownershipFlags',
    ] as const,
  },
  'budget.summary.v1': {
    packageId: 'budget.summary.v1',
    version: 1,
    sourceBrandId: 'symply-budget',
    destinationBrandId: 'symply-house',
    requiresSourceHousehold: true,
    requiresDestinationHousehold: true,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: [
      'currency',
      'monthTotal',
      'ytdTotal',
      'remaining',
      'topCategories',
    ] as const,
  },
  'home_project_cost_summary.v1': {
    packageId: 'home_project_cost_summary.v1',
    version: 1,
    sourceBrandId: 'symply-house',
    destinationBrandId: 'symply-budget',
    requiresSourceHousehold: true,
    requiresDestinationHousehold: true,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: [
      'projectId',
      'title',
      'currency',
      'targetBudgetCents',
      'estimateTotalCents',
      'actualTotalCents',
      'categoryRollups',
    ] as const,
  },
  'profile.core.health.v1': {
    packageId: 'profile.core.health.v1',
    version: 1,
    sourceBrandId: 'symply-house',
    destinationBrandId: 'symply-health',
    requiresSourceHousehold: false,
    requiresDestinationHousehold: false,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: ['displayName', 'locale', 'timezone'] as const,
  },
  'health.summary.v1': {
    packageId: 'health.summary.v1',
    version: 1,
    sourceBrandId: 'symply-health',
    destinationBrandId: 'symply-house',
    requiresSourceHousehold: false,
    requiresDestinationHousehold: true,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: ['periodLabel', 'checkInCount', 'goalProgress'] as const,
  },
  'profile.core.language.v1': {
    packageId: 'profile.core.language.v1',
    version: 1,
    sourceBrandId: 'symply-house',
    destinationBrandId: 'symply-language',
    requiresSourceHousehold: false,
    requiresDestinationHousehold: false,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: ['displayName', 'locale', 'timezone'] as const,
  },
  'language.summary.v1': {
    packageId: 'language.summary.v1',
    version: 1,
    sourceBrandId: 'symply-language',
    destinationBrandId: 'symply-house',
    requiresSourceHousehold: false,
    requiresDestinationHousehold: true,
    maxEnvelopeTtlMs: 5 * 60 * 1000,
    fieldManifest: ['periodLabel', 'lessonsCompleted', 'streakDays'] as const,
  },
};

export const TRANSFER_PACKAGE_CATALOG: Readonly<
  Record<TransferPackageId, TransferPackageCatalogEntry>
> = {
  'profile.core.v1': {
    label: 'Profile basics',
    description: 'Display name, locale, basic profile fields',
    requiresAi: false,
  },
  'house.property.v1': {
    label: 'Household property summary',
    description: 'Property address / household summary for Budget onboarding',
    requiresAi: false,
  },
  'budget.summary.v1': {
    label: 'Budget year summary',
    description: 'High-level budget year totals (no line-item dump)',
    requiresAi: false,
  },
  'home_project_cost_summary.v1': {
    label: 'Home project cost summary',
    description: 'Estimate/actual totals by category for a House renovation project (no product links)',
    requiresAi: false,
  },
  'profile.core.health.v1': {
    label: 'Profile basics (Health)',
    description: 'Display name, locale, and timezone for Symply Health onboarding',
    requiresAi: false,
  },
  'health.summary.v1': {
    label: 'Health check-in summary',
    description: 'High-level health check-in and goal progress for House',
    requiresAi: false,
  },
  'profile.core.language.v1': {
    label: 'Profile basics (Language)',
    description: 'Display name, locale, and timezone for Symply Language onboarding',
    requiresAi: false,
  },
  'language.summary.v1': {
    label: 'Language learning summary',
    description: 'High-level lesson and streak progress for House',
    requiresAi: false,
  },
};

export const TRANSFER_PACKAGE_LABELS: Readonly<Record<TransferPackageId, string>> = {
  'profile.core.v1': TRANSFER_PACKAGE_CATALOG['profile.core.v1'].label,
  'house.property.v1': TRANSFER_PACKAGE_CATALOG['house.property.v1'].label,
  'budget.summary.v1': TRANSFER_PACKAGE_CATALOG['budget.summary.v1'].label,
  'home_project_cost_summary.v1':
    TRANSFER_PACKAGE_CATALOG['home_project_cost_summary.v1'].label,
  'profile.core.health.v1': TRANSFER_PACKAGE_CATALOG['profile.core.health.v1'].label,
  'health.summary.v1': TRANSFER_PACKAGE_CATALOG['health.summary.v1'].label,
  'profile.core.language.v1': TRANSFER_PACKAGE_CATALOG['profile.core.language.v1'].label,
  'language.summary.v1': TRANSFER_PACKAGE_CATALOG['language.summary.v1'].label,
};

export function getTransferPackage(id: string): TransferPackageDef | undefined {
  return TRANSFER_PACKAGES[id as TransferPackageId];
}
