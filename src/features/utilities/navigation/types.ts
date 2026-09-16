/**
 * Utilities stack route map — owned by the feature, not the navigation hub.
 *
 * `src/navigation/types.ts` re-exports this so existing `@navigation/types`
 * consumers keep working; the definition lives here so the feature stays
 * self-contained.
 */
import type { ProviderKey, UtilityBill } from '../api/utilities';

export type UtilitiesStackParamList = {
  UtilitiesMain: undefined;
  UtilityBills: undefined;
  // No billId → add a new bill. With billId → edit that existing bill.
  AddUtilityBill: { billId?: string } | undefined;
  // Post-import review: confirm paid/unpaid status for the just-imported bills.
  ConfirmBillPayments: { bills: UtilityBill[] };
  UtilityDetail: { billId: string };
  PropertyTax: undefined;
  AddPropertyTax: undefined;
  UtilityCharts: undefined;
  UtilitySettings: undefined;
  UtilityProvider: { providerKey: ProviderKey };
};
