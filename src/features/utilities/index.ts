/**
 * Symply House — Utilities feature module.
 *
 * Self-contained House surface: utility bills, property tax and BC Assessment.
 * Owns its own screens, navigator, API client, provider catalog and brand gate.
 *
 * Not connected to the Budget product. See `./gate.ts` for why.
 *
 * The local-first slice lives with the House ledger engine
 * (`@features/house/local/localUtilitiesApi`) because the engine imports it —
 * that module is House infrastructure, not a Utilities dependency.
 */
export { isUtilitiesEnabled } from './gate';
export { UtilitiesNavigator } from './navigation/UtilitiesNavigator';
export type { UtilitiesStackParamList } from './navigation/types';

export { utilitiesApi, getDuplicateBill } from './api/utilities';
export type {
  UtilityBill,
  UtilityAccount,
  PropertyTax,
  BCAssessmentData,
  DashboardOverview,
  BillAnalytics,
  ProviderKey,
  MunicipalityConfig,
} from './api/utilities';

export { PROVIDER_META, CHART_FILTER_TYPES, getBillTypeIonicon } from './providers/bill-providers';
export { getProviderLogo, hasProviderLogo } from './providers/provider-logos';
export { ProviderLogo } from './components/ProviderLogo';
