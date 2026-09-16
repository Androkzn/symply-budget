import type { TransferPackageId } from '@api/smart-engine';
import { getBrandById } from '@brand';
import { TRANSFER_PACKAGE_CATALOG } from '@symply/contracts';

export const PACKAGE_LABELS: Record<
  TransferPackageId,
  { title: string; summary: string; contents: string }
> = {
  'profile.core.v1': {
    title: TRANSFER_PACKAGE_CATALOG['profile.core.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['profile.core.v1'].description,
    contents: 'Display name, locale, timezone',
  },
  'house.property.v1': {
    title: TRANSFER_PACKAGE_CATALOG['house.property.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['house.property.v1'].description,
    contents: 'City/region, property type, household size band, ownership flags',
  },
  'budget.summary.v1': {
    title: TRANSFER_PACKAGE_CATALOG['budget.summary.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['budget.summary.v1'].description,
    contents: 'Currency, month and year totals, remaining balance, top categories',
  },
  'home_project_cost_summary.v1': {
    title: TRANSFER_PACKAGE_CATALOG['home_project_cost_summary.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['home_project_cost_summary.v1'].description,
    contents: 'Project title, target/estimate/actual totals, category rollups',
  },
  'profile.core.health.v1': {
    title: TRANSFER_PACKAGE_CATALOG['profile.core.health.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['profile.core.health.v1'].description,
    contents: 'Display name, locale, timezone',
  },
  'health.summary.v1': {
    title: TRANSFER_PACKAGE_CATALOG['health.summary.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['health.summary.v1'].description,
    contents: 'Period label, check-in count, goal progress',
  },
  'profile.core.language.v1': {
    title: TRANSFER_PACKAGE_CATALOG['profile.core.language.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['profile.core.language.v1'].description,
    contents: 'Display name, locale, timezone',
  },
  'language.summary.v1': {
    title: TRANSFER_PACKAGE_CATALOG['language.summary.v1'].label,
    summary: TRANSFER_PACKAGE_CATALOG['language.summary.v1'].description,
    contents: 'Period label, lessons completed, streak days',
  },
};

export function getBrandDisplayName(brandId: string): string {
  try {
    return getBrandById(brandId).displayName;
  } catch {
    return brandId;
  }
}

export function getPackageLabel(packageId: TransferPackageId) {
  return PACKAGE_LABELS[packageId];
}
